import { describe, expect, it } from "vitest";

import {
  ORDER_HAPPY_PATH,
  ORDER_STATUSES,
  ORDER_TERMINAL_STATUSES,
  isTerminalOrderStatus,
  requiresRefundDecision,
  type OrderStatus,
} from "./status.js";
import {
  ORDER_TRANSITIONS,
  OrderTransitionError,
  allowedNextStatuses,
  assertTransition,
  checkTransition,
  outgoingTransitions,
} from "./transitions.js";

describe("intégrité de la table de transitions", () => {
  it("ne référence que des statuts connus", () => {
    for (const transition of ORDER_TRANSITIONS) {
      expect(ORDER_STATUSES).toContain(transition.from);
      expect(ORDER_STATUSES).toContain(transition.to);
    }
  });

  it("ne contient aucun doublon from → to", () => {
    const seen = new Set<string>();
    for (const { from, to } of ORDER_TRANSITIONS) {
      const key = `${from}→${to}`;
      expect(seen.has(key), `transition dupliquée : ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("n'autorise aucune transition sans acteur", () => {
    for (const transition of ORDER_TRANSITIONS) {
      expect(transition.actors.length, `${transition.from} → ${transition.to}`).toBeGreaterThan(0);
    }
  });

  it("ne laisse sortir aucune transition d'un état terminal", () => {
    for (const status of ORDER_TERMINAL_STATUSES) {
      expect(outgoingTransitions(status)).toHaveLength(0);
    }
  });

  it("rend tout état non terminal atteignable depuis CART", () => {
    const reached = new Set<OrderStatus>(["CART"]);
    const queue: OrderStatus[] = ["CART"];
    while (queue.length > 0) {
      const current = queue.shift() as OrderStatus;
      for (const { to } of outgoingTransitions(current)) {
        if (!reached.has(to)) {
          reached.add(to);
          queue.push(to);
        }
      }
    }
    for (const status of ORDER_STATUSES) {
      expect(reached.has(status), `${status} est inatteignable`).toBe(true);
    }
  });

  it("laisse une sortie à tout état non terminal", () => {
    for (const status of ORDER_STATUSES) {
      if (isTerminalOrderStatus(status)) continue;
      expect(outgoingTransitions(status).length, `${status} est un cul-de-sac`).toBeGreaterThan(0);
    }
  });
});

describe("chemin nominal", () => {
  it("enchaîne CART → DELIVERED sans trou", () => {
    for (let i = 0; i < ORDER_HAPPY_PATH.length - 1; i += 1) {
      const from = ORDER_HAPPY_PATH[i] as OrderStatus;
      const to = ORDER_HAPPY_PATH[i + 1] as OrderStatus;
      const outgoing = outgoingTransitions(from).map((t) => t.to);
      expect(outgoing, `${from} ne mène pas à ${to}`).toContain(to);
    }
  });
});

describe("contrôle des acteurs", () => {
  it("laisse le shop accepter une commande payée", () => {
    expect(checkTransition("PAID", "ACCEPTED", "merchant_staff").ok).toBe(true);
  });

  it("empêche le client de marquer sa propre commande livrée", () => {
    const result = checkTransition("OUT_FOR_DELIVERY", "DELIVERED", "customer");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ACTOR_NOT_ALLOWED");
  });

  it("empêche le coursier d'accepter une commande à la place du shop", () => {
    const result = checkTransition("PAID", "ACCEPTED", "courier");
    expect(result.ok).toBe(false);
  });

  it("réserve la confirmation de paiement au système", () => {
    expect(checkTransition("PENDING_PAYMENT", "PAID", "system").ok).toBe(true);
    expect(checkTransition("PENDING_PAYMENT", "PAID", "customer").ok).toBe(false);
    expect(checkTransition("PENDING_PAYMENT", "PAID", "admin").ok).toBe(false);
  });

  it("interdit un saut d'étape même à un admin", () => {
    const result = checkTransition("PAID", "DELIVERED", "admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNKNOWN_TRANSITION");
  });

  it("ne donne au support_agent aucun pouvoir de transition directe", () => {
    for (const status of ORDER_STATUSES) {
      expect(allowedNextStatuses(status, "support_agent")).toHaveLength(0);
    }
  });
});

describe("assertTransition", () => {
  it("renvoie la transition quand elle est permise", () => {
    expect(assertTransition("PREPARING", "READY_FOR_PICKUP", "merchant_owner").to).toBe(
      "READY_FOR_PICKUP",
    );
  });

  it("lève une OrderTransitionError sinon", () => {
    expect(() => assertTransition("CART", "DELIVERED", "customer")).toThrow(OrderTransitionError);
  });
});

describe("reprise après échec de livraison", () => {
  it("permet une nouvelle tentative après un client injoignable", () => {
    expect(checkTransition("CUSTOMER_UNAVAILABLE", "OUT_FOR_DELIVERY", "courier").ok).toBe(true);
  });

  it("laisse le support sortir d'un incident", () => {
    expect(allowedNextStatuses("INCIDENT", "admin").length).toBeGreaterThan(0);
  });
});

describe("requiresRefundDecision", () => {
  it("signale une annulation après encaissement", () => {
    expect(requiresRefundDecision("PREPARING", "CANCELLED")).toBe(true);
    expect(requiresRefundDecision("OUT_FOR_DELIVERY", "DELIVERY_FAILED")).toBe(true);
  });

  it("ne signale rien avant encaissement", () => {
    expect(requiresRefundDecision("CART", "CANCELLED")).toBe(false);
    expect(requiresRefundDecision("PENDING_PAYMENT", "CANCELLED")).toBe(false);
  });

  it("ne signale rien sur le chemin nominal", () => {
    expect(requiresRefundDecision("PICKED_UP", "OUT_FOR_DELIVERY")).toBe(false);
    expect(requiresRefundDecision("OUT_FOR_DELIVERY", "DELIVERED")).toBe(false);
  });
});
