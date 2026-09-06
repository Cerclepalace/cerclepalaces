/**
 * Tests adversariaux du mode de libération.
 *
 * Le mode décide quelle machine à états s'applique à une commande. S'il peut
 * être absent, corrompu ou deviné, il ne décide rien. Cette suite ne décrit
 * aucun parcours : elle essaie de faire avancer une commande avec un mode que le
 * système ne devrait pas accepter.
 *
 * Toutes ces valeurs franchissent le compilateur dans la vraie vie — elles
 * viennent d'une base, d'un JSON désérialisé ou d'un `as`. Le typage ne survit
 * pas à la frontière du processus ; c'est pour cela qu'elles sont testées.
 */

import { tenantScope, type OrderFulfillmentMode, type OrderStatus } from "@cbd/domain";
import { describe, expect, it } from "vitest";

import { transitionOrder } from "./service.js";
import { FakeOrderStore, anOrder } from "./store.fake.js";

const shop = tenantScope("mer_a");

/** Tout ce qu'on peut trouver à la place d'un mode. */
const MODES_HOSTILES: readonly unknown[] = [
  undefined,
  null,
  "",
  "   ",
  "PAYMENT_REQUIRED",
  "SIMULATED",
  "PAYMENT_REQUIRED ",
  " MERCHANT_DIRECT",
  "MERCHANT_DIRECT ",
  "merchant_direct",
  "Merchant_Direct",
  "MERCHANT-DIRECT",
  "EXTERNAL_CONFIRMATION\n",
  0,
  1,
  true,
  {},
  [],
  ["MERCHANT_DIRECT"],
];

const commandeAvecMode = (mode: unknown, status: OrderStatus = "CART") =>
  new FakeOrderStore([
    anOrder({ status, fulfillmentMode: mode as OrderFulfillmentMode, version: 1 }),
  ]);

describe("un mode illisible n'ouvre aucune porte", () => {
  it("refuse le passage direct vers le shop", async () => {
    for (const mode of MODES_HOSTILES) {
      const store = commandeAvecMode(mode);
      await expect(
        transitionOrder(store, shop, {
          orderId: "ord_1",
          toStatus: "ACCEPTED",
          actor: "merchant_staff",
          actorUserId: "usr_shop",
        }),
        JSON.stringify(mode),
      ).rejects.toThrow();
      expect(store.get("ord_1")?.status, JSON.stringify(mode)).toBe("CART");
      expect(store.statusEvents, JSON.stringify(mode)).toHaveLength(0);
    }
  });

  it("refuse l'entrée dans un état de paiement", async () => {
    for (const mode of MODES_HOSTILES) {
      const store = commandeAvecMode(mode);
      await expect(
        transitionOrder(store, shop, {
          orderId: "ord_1",
          toStatus: "PENDING_PAYMENT",
          actor: "customer",
          actorUserId: "usr_client",
        }),
        JSON.stringify(mode),
      ).rejects.toThrow();
    }
  });

  it("refuse aussi les transitions que le mode ne restreint pas", async () => {
    // C'est ici que se cachait la faille : la majeure partie du parcours ne
    // dépend pas du mode, et une valeur corrompue la traversait entièrement.
    for (const mode of MODES_HOSTILES) {
      const store = commandeAvecMode(mode, "ACCEPTED");
      await expect(
        transitionOrder(store, shop, {
          orderId: "ord_1",
          toStatus: "PREPARING",
          actor: "merchant_staff",
          actorUserId: "usr_shop",
        }),
        JSON.stringify(mode),
      ).rejects.toThrow();
      expect(store.get("ord_1")?.status, JSON.stringify(mode)).toBe("ACCEPTED");
    }
  });

  it("distingue « mode illisible » de « transition interdite dans ce mode »", async () => {
    // Deux incidents différents : donnée corrompue d'un côté, parcours mal
    // suivi de l'autre. Les confondre envoie chercher au mauvais endroit.
    const corrompu = commandeAvecMode("SIMULATED");
    await expect(
      transitionOrder(corrompu, shop, {
        orderId: "ord_1",
        toStatus: "ACCEPTED",
        actor: "merchant_staff",
        actorUserId: "usr_shop",
      }),
    ).rejects.toThrow(/absent ou inconnu/i);

    const bonModeMauvaisChemin = commandeAvecMode("EXTERNAL_CONFIRMATION");
    await expect(
      transitionOrder(bonModeMauvaisChemin, shop, {
        orderId: "ord_1",
        toStatus: "ACCEPTED",
        actor: "merchant_staff",
        actorUserId: "usr_shop",
      }),
    ).rejects.toThrow(/réservée au flux direct/i);
  });
});

describe("les deux modes officiels fonctionnent", () => {
  it("MERCHANT_DIRECT : le shop libère lui-même", async () => {
    const store = commandeAvecMode("MERCHANT_DIRECT");
    const résultat = await transitionOrder(store, shop, {
      orderId: "ord_1",
      toStatus: "ACCEPTED",
      actor: "merchant_staff",
      actorUserId: "usr_shop",
    });
    expect(résultat.toStatus).toBe("ACCEPTED");
  });

  it("EXTERNAL_CONFIRMATION : sans confirmation, la commande n'avance pas", async () => {
    const store = commandeAvecMode("EXTERNAL_CONFIRMATION", "PENDING_PAYMENT");

    // Le shop ne peut rien tant que la confirmation n'est pas arrivée.
    await expect(
      transitionOrder(store, shop, {
        orderId: "ord_1",
        toStatus: "ACCEPTED",
        actor: "merchant_staff",
        actorUserId: "usr_shop",
      }),
    ).rejects.toThrow();
    expect(store.get("ord_1")?.status).toBe("PENDING_PAYMENT");

    // Et la confirmation n'est ouverte qu'au système, jamais à une requête.
    for (const acteur of ["customer", "merchant_owner", "admin", "driver"] as const) {
      await expect(
        transitionOrder(store, shop, {
          orderId: "ord_1",
          toStatus: "PAID",
          actor: acteur,
          actorUserId: "usr_x",
        }),
        acteur,
      ).rejects.toThrow();
    }
    expect(store.get("ord_1")?.status).toBe("PENDING_PAYMENT");
  });
});

describe("le mode n'est pas fourni par la requête", () => {
  it("ignore un mode glissé dans la commande de transition", async () => {
    // `TransitionCommand` ne porte aucun champ de mode. Un appelant qui en
    // ajoute un ne change rien : le service lit celui de la commande.
    const store = commandeAvecMode("EXTERNAL_CONFIRMATION");
    const commande = {
      orderId: "ord_1",
      toStatus: "ACCEPTED",
      actor: "merchant_staff",
      actorUserId: "usr_shop",
      fulfillmentMode: "MERCHANT_DIRECT",
    } as unknown as Parameters<typeof transitionOrder>[2];

    await expect(transitionOrder(store, shop, commande)).rejects.toThrow();
    expect(store.get("ord_1")?.status).toBe("CART");
  });
});

describe("changement de mode après création", () => {
  it("n'est ni permis ni interdit par le code — le service ne l'expose pas", () => {
    // Constat, pas règle. `OrderRepository` n'a aucune méthode d'écriture du
    // mode, et aucun service de création de commande n'existe encore. La
    // question « un mode peut-il changer en cours de vie ? » n'est donc tranchée
    // ni par le code, ni par la documentation. Ce test fige le constat pour
    // qu'il soit revu quand la création de commande sera écrite, plutôt que
    // d'inventer une règle métier ici.
    const store = new FakeOrderStore([anOrder({ fulfillmentMode: "MERCHANT_DIRECT" })]);
    const repo = Object.keys(store);
    expect(repo).not.toContain("updateFulfillmentMode");
  });
});
