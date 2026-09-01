import { describe, expect, it } from "vitest";

import {
  ORDER_FULFILMENT_MODES,
  ORDER_HAPPY_PATH,
  ORDER_PAYMENT_STATES,
  ORDER_STATUSES,
  ORDER_TERMINAL_STATUSES,
  isPaymentState,
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
  SIMULATED_HAPPY_PATH,
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
    const result = checkTransition("PAID", "ACCEPTED", "driver");
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
    expect(checkTransition("CUSTOMER_UNAVAILABLE", "OUT_FOR_DELIVERY", "driver").ok).toBe(true);
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

// ---------------------------------------------------------------------------
// Commande simulée : le parcours du pilote, sans argent
// ---------------------------------------------------------------------------

describe("mode de traitement", () => {
  it("interdit les états de paiement à une commande simulée", () => {
    // C'est la garantie centrale : une commande simulée ne peut pas prétendre
    // avoir été payée. Pas « ne le fait pas » — ne le peut pas.
    for (const état of ORDER_PAYMENT_STATES) {
      const résultat = checkTransition("CART", état, "customer", "SIMULATED");
      expect(résultat.ok, état).toBe(false);
    }
  });

  it("dit pourquoi plutôt que de prétendre que la transition n'existe pas", () => {
    const résultat = checkTransition("CART", "PENDING_PAYMENT", "customer", "SIMULATED");
    expect(résultat.ok).toBe(false);
    if (!résultat.ok) {
      expect(résultat.code).toBe("MODE_NOT_ALLOWED");
      expect(résultat.message).toContain("encaissement");
    }
  });

  it("réserve le raccourci CART → ACCEPTED aux commandes simulées", () => {
    expect(checkTransition("CART", "ACCEPTED", "merchant_owner", "SIMULATED").ok).toBe(true);

    const payant = checkTransition("CART", "ACCEPTED", "merchant_owner", "PAYMENT_REQUIRED");
    expect(payant.ok).toBe(false);
    if (!payant.ok) expect(payant.code).toBe("MODE_NOT_ALLOWED");
  });

  it("retient le mode payant quand l'appelant l'oublie", () => {
    // Un oubli doit fermer le raccourci, pas ouvrir un chemin vers PAID.
    expect(checkTransition("CART", "ACCEPTED", "merchant_owner").ok).toBe(false);
    expect(checkTransition("CART", "PENDING_PAYMENT", "customer").ok).toBe(true);
  });

  it("laisse un client abandonner son panier dans les deux modes", () => {
    for (const mode of ORDER_FULFILMENT_MODES) {
      expect(checkTransition("CART", "CANCELLED", "customer", mode).ok, mode).toBe(true);
    }
  });

  it("ne change rien à partir de l'acceptation", () => {
    // Une fois la commande acceptée, le parcours est le même : préparation,
    // dispatch, livraison. Le mode ne concerne que l'entrée.
    const paires = [
      ["ACCEPTED", "PREPARING"],
      ["PREPARING", "READY_FOR_PICKUP"],
      ["READY_FOR_PICKUP", "DRIVER_ASSIGNED"],
      ["OUT_FOR_DELIVERY", "DELIVERED"],
    ] as const;
    for (const [de, vers] of paires) {
      const simulé = allowedNextStatuses(de, "system", "SIMULATED");
      const payant = allowedNextStatuses(de, "system", "PAYMENT_REQUIRED");
      expect(new Set(simulé), `${de}→${vers}`).toEqual(new Set(payant));
    }
  });

  it("décrit un parcours simulé complet, du panier à la livraison", () => {
    expect(SIMULATED_HAPPY_PATH).toEqual([
      "CART",
      "ACCEPTED",
      "PREPARING",
      "READY_FOR_PICKUP",
      "DRIVER_ASSIGNED",
      "PICKED_UP",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ]);
  });

  it("ne fait passer le parcours simulé par aucun état de paiement", () => {
    for (const état of SIMULATED_HAPPY_PATH) {
      expect(isPaymentState(état), état).toBe(false);
    }
  });

  it("laisse un shop refuser une commande simulée", () => {
    // Sans cette sortie, un shop devrait accepter une commande simulée qu'il
    // ne veut pas, ou la laisser en panier indéfiniment.
    expect(checkTransition("CART", "MERCHANT_REJECTED", "merchant_owner", "SIMULATED").ok).toBe(
      true,
    );
  });
});

describe("question de remboursement", () => {
  it("ne se pose jamais sur une commande simulée", () => {
    // Rien n'a été encaissé : il n'y a rien à rembourser.
    expect(requiresRefundDecision("PREPARING", "CANCELLED", "SIMULATED")).toBe(false);
    expect(requiresRefundDecision("OUT_FOR_DELIVERY", "DELIVERY_FAILED", "SIMULATED")).toBe(false);
  });

  it("se pose toujours sur une commande payante", () => {
    expect(requiresRefundDecision("PREPARING", "CANCELLED", "PAYMENT_REQUIRED")).toBe(true);
  });

  it("retient le mode prudent quand l'appelant l'oublie", () => {
    // Une question posée à tort se voit ; une question omise, non.
    expect(requiresRefundDecision("PREPARING", "CANCELLED")).toBe(true);
  });
});
