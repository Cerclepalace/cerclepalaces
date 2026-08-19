import { OrderTransitionError } from "@cbd/domain";
import { describe, expect, it } from "vitest";

import {
  OrderConflictError,
  OrderNotFoundError,
  transitionOrder,
} from "./service.js";
import { FakeOrderStore, anOrder } from "./store.fake.js";

describe("transition acceptée", () => {
  it("écrit le statut et son événement d'historique ensemble", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PAID" })]);

    const result = await transitionOrder(store, {
      orderId: "ord_1",
      toStatus: "ACCEPTED",
      actor: "merchant_staff",
      actorUserId: "usr_shop",
    });

    expect(result.toStatus).toBe("ACCEPTED");
    expect(store.get("ord_1")?.status).toBe("ACCEPTED");
    expect(store.statusEvents).toHaveLength(1);
    expect(store.statusEvents[0]).toMatchObject({
      fromStatus: "PAID",
      toStatus: "ACCEPTED",
      actorRole: "merchant_staff",
      actorId: "usr_shop",
    });
  });

  it("incrémente la version à chaque écriture", async () => {
    const store = new FakeOrderStore([anOrder({ status: "ACCEPTED", version: 4 })]);
    await transitionOrder(store, {
      orderId: "ord_1",
      toStatus: "PREPARING",
      actor: "merchant_owner",
      actorUserId: "usr_shop",
    });
    expect(store.get("ord_1")?.version).toBe(5);
  });

  it("enregistre la raison métier de la transition", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PREPARING" })]);
    await transitionOrder(store, {
      orderId: "ord_1",
      toStatus: "READY_FOR_PICKUP",
      actor: "merchant_staff",
      actorUserId: "usr_shop",
    });
    expect(store.statusEvents[0]?.reason).toMatch(/prête/i);
  });
});

describe("transitions refusées", () => {
  it("refuse un acteur non autorisé et n'écrit rien", async () => {
    const store = new FakeOrderStore([anOrder({ status: "OUT_FOR_DELIVERY" })]);

    await expect(
      transitionOrder(store, {
        orderId: "ord_1",
        toStatus: "DELIVERED",
        actor: "customer",
        actorUserId: "usr_client",
      }),
    ).rejects.toThrow(OrderTransitionError);

    expect(store.get("ord_1")?.status).toBe("OUT_FOR_DELIVERY");
    expect(store.statusEvents).toHaveLength(0);
    expect(store.auditEntries).toHaveLength(0);
  });

  it("refuse un saut d'étape même à un admin", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PAID" })]);
    await expect(
      transitionOrder(store, {
        orderId: "ord_1",
        toStatus: "DELIVERED",
        actor: "admin",
        actorUserId: "usr_admin",
      }),
    ).rejects.toThrow(OrderTransitionError);
    expect(store.get("ord_1")?.status).toBe("PAID");
  });

  it("refuse toute transition depuis un état terminal", async () => {
    const store = new FakeOrderStore([anOrder({ status: "DELIVERED" })]);
    await expect(
      transitionOrder(store, {
        orderId: "ord_1",
        toStatus: "CANCELLED",
        actor: "admin",
        actorUserId: "usr_admin",
      }),
    ).rejects.toThrow(OrderConflictError);
  });

  it("signale une commande inexistante", async () => {
    const store = new FakeOrderStore([]);
    await expect(
      transitionOrder(store, {
        orderId: "inconnu",
        toStatus: "ACCEPTED",
        actor: "merchant_owner",
        actorUserId: "usr_shop",
      }),
    ).rejects.toThrow(OrderNotFoundError);
  });

  it("refuse un acteur système porteur d'un utilisateur", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PENDING_PAYMENT" })]);
    await expect(
      transitionOrder(store, {
        orderId: "ord_1",
        toStatus: "PAID",
        actor: "system",
        actorUserId: "usr_client",
      }),
    ).rejects.toThrow(/système/i);
  });
});

describe("écritures concurrentes", () => {
  it("rejette la seconde écriture au lieu d'écraser la première", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PAID", version: 1 })]);
    // Quelqu'un d'autre écrit entre la lecture et l'écriture.
    store.onBeforeUpdate = (orderId) => store.bumpVersion(orderId);

    await expect(
      transitionOrder(store, {
        orderId: "ord_1",
        toStatus: "ACCEPTED",
        actor: "merchant_owner",
        actorUserId: "usr_shop",
      }),
    ).rejects.toThrow(OrderConflictError);

    expect(store.statusEvents).toHaveLength(0);
  });
});

describe("idempotence", () => {
  it("ne produit pas de second événement quand un webhook est rejoué", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PENDING_PAYMENT" })]);

    const command = {
      orderId: "ord_1",
      toStatus: "PAID" as const,
      actor: "system" as const,
      actorUserId: null,
    };

    await transitionOrder(store, command);
    await transitionOrder(store, command);
    await transitionOrder(store, command);

    expect(store.get("ord_1")?.status).toBe("PAID");
    expect(store.statusEvents).toHaveLength(1);
  });
});

describe("traçabilité", () => {
  it("audite une escalade en incident, sans y voir un remboursement", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PREPARING" })]);

    const result = await transitionOrder(store, {
      orderId: "ord_1",
      toStatus: "INCIDENT",
      actor: "admin",
      actorUserId: "usr_admin",
    });

    // Un incident est une escalade : la question du remboursement se pose
    // quand il se referme, pas quand il s'ouvre.
    expect(result.refundDecisionRequired).toBe(false);
    expect(store.auditEntries).toHaveLength(1);
    expect(store.auditEntries[0]).toMatchObject({
      actorUserId: "usr_admin",
      targetType: "Order",
      targetId: "ord_1",
    });
  });

  it("signale le remboursement quand l'incident se referme en annulation", async () => {
    const store = new FakeOrderStore([anOrder({ status: "INCIDENT" })]);

    const result = await transitionOrder(store, {
      orderId: "ord_1",
      toStatus: "CANCELLED",
      actor: "admin",
      actorUserId: "usr_admin",
    });

    expect(result.refundDecisionRequired).toBe(true);
    expect(store.auditEntries[0]?.metadata).toMatchObject({ refundDecisionRequired: true });
  });

  it("n'audite pas une étape ordinaire du chemin nominal", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PAID" })]);
    await transitionOrder(store, {
      orderId: "ord_1",
      toStatus: "ACCEPTED",
      actor: "merchant_owner",
      actorUserId: "usr_shop",
    });
    expect(store.auditEntries).toHaveLength(0);
    expect(store.statusEvents).toHaveLength(1);
  });

  it("audite une livraison confirmée", async () => {
    const store = new FakeOrderStore([anOrder({ status: "OUT_FOR_DELIVERY" })]);
    await transitionOrder(store, {
      orderId: "ord_1",
      toStatus: "DELIVERED",
      actor: "courier",
      actorUserId: "usr_coursier",
    });
    expect(store.auditEntries).toHaveLength(1);
  });

  it("ne signale pas de remboursement avant encaissement", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PENDING_PAYMENT" })]);
    const result = await transitionOrder(store, {
      orderId: "ord_1",
      toStatus: "CANCELLED",
      actor: "customer",
      actorUserId: "usr_client",
    });
    expect(result.refundDecisionRequired).toBe(false);
  });
});

describe("parcours complet", () => {
  it("déroule une commande du paiement à la livraison", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PENDING_PAYMENT" })]);

    const étapes = [
      { toStatus: "PAID", actor: "system", actorUserId: null },
      { toStatus: "ACCEPTED", actor: "merchant_staff", actorUserId: "usr_shop" },
      { toStatus: "PREPARING", actor: "merchant_staff", actorUserId: "usr_shop" },
      { toStatus: "READY_FOR_PICKUP", actor: "merchant_staff", actorUserId: "usr_shop" },
      { toStatus: "COURIER_ASSIGNED", actor: "system", actorUserId: null },
      { toStatus: "PICKED_UP", actor: "courier", actorUserId: "usr_coursier" },
      { toStatus: "OUT_FOR_DELIVERY", actor: "courier", actorUserId: "usr_coursier" },
      { toStatus: "DELIVERED", actor: "courier", actorUserId: "usr_coursier" },
    ] as const;

    for (const étape of étapes) {
      await transitionOrder(store, { orderId: "ord_1", ...étape });
    }

    expect(store.get("ord_1")?.status).toBe("DELIVERED");
    expect(store.statusEvents).toHaveLength(8);
    // L'historique reconstitue la commande dans l'ordre, sans trou.
    expect(store.statusEvents.map((e) => e.toStatus)).toEqual(étapes.map((e) => e.toStatus));
  });
});
