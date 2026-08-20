import { describe, expect, it } from "vitest";

import {
  DELIVERY_STATUSES,
  DELIVERY_TERMINAL_STATUSES,
  DELIVERY_TRANSITIONS,
  DeliveryTransitionError,
  allowedNextDeliveryStatuses,
  assertDeliveryTransition,
  checkDeliveryTransition,
  isTerminalDeliveryStatus,
  outgoingDeliveryTransitions,
  type DeliveryStatus,
} from "./status.js";

describe("intégrité de la table", () => {
  it("ne référence que des statuts connus", () => {
    for (const transition of DELIVERY_TRANSITIONS) {
      expect(DELIVERY_STATUSES).toContain(transition.from);
      expect(DELIVERY_STATUSES).toContain(transition.to);
    }
  });

  it("ne contient aucun doublon from → to", () => {
    const seen = new Set<string>();
    for (const { from, to } of DELIVERY_TRANSITIONS) {
      const key = `${from}→${to}`;
      expect(seen.has(key), `transition dupliquée : ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("n'autorise aucune transition sans acteur", () => {
    for (const transition of DELIVERY_TRANSITIONS) {
      expect(transition.actors.length, `${transition.from} → ${transition.to}`).toBeGreaterThan(0);
    }
  });

  it("rend tout statut atteignable depuis PENDING_DISPATCH", () => {
    const reached = new Set<DeliveryStatus>(["PENDING_DISPATCH"]);
    const queue: DeliveryStatus[] = ["PENDING_DISPATCH"];
    while (queue.length > 0) {
      const current = queue.shift() as DeliveryStatus;
      for (const { to } of outgoingDeliveryTransitions(current)) {
        if (!reached.has(to)) {
          reached.add(to);
          queue.push(to);
        }
      }
    }
    for (const status of DELIVERY_STATUSES) {
      expect(reached.has(status), `${status} est inatteignable`).toBe(true);
    }
  });

  it("laisse une sortie à tout statut non terminal", () => {
    for (const status of DELIVERY_STATUSES) {
      if (isTerminalDeliveryStatus(status)) continue;
      expect(outgoingDeliveryTransitions(status).length, `${status} est un cul-de-sac`).toBeGreaterThan(0);
    }
  });
});

// TEST 9 de la mission.
describe("états terminaux", () => {
  it("ne laisse sortir aucune transition", () => {
    for (const status of DELIVERY_TERMINAL_STATUSES) {
      expect(outgoingDeliveryTransitions(status)).toHaveLength(0);
    }
  });

  it("interdit tout changement après DELIVERED, quel que soit l'acteur", () => {
    for (const target of DELIVERY_STATUSES) {
      for (const actor of ["driver", "admin", "system"] as const) {
        expect(checkDeliveryTransition("DELIVERED", target, actor).ok).toBe(false);
      }
    }
  });

  it("interdit tout changement après FAILED et CANCELLED", () => {
    for (const from of ["FAILED", "CANCELLED"] as const) {
      for (const target of DELIVERY_STATUSES) {
        expect(checkDeliveryTransition(from, target, "admin").ok).toBe(false);
      }
    }
  });

  it("ne compte pas UNASSIGNED comme terminal : une course rendue repart", () => {
    expect(isTerminalDeliveryStatus("UNASSIGNED")).toBe(false);
    expect(checkDeliveryTransition("UNASSIGNED", "OFFERING", "system").ok).toBe(true);
  });
});

describe("chemin nominal", () => {
  it("enchaîne PENDING_DISPATCH → DELIVERED sans trou", () => {
    const chemin: readonly DeliveryStatus[] = [
      "PENDING_DISPATCH",
      "OFFERING",
      "ASSIGNED",
      "PICKED_UP",
      "IN_TRANSIT",
      "DELIVERED",
    ];
    for (let i = 0; i < chemin.length - 1; i += 1) {
      const from = chemin[i] as DeliveryStatus;
      const to = chemin[i + 1] as DeliveryStatus;
      expect(outgoingDeliveryTransitions(from).map((t) => t.to), `${from} ne mène pas à ${to}`).toContain(to);
    }
  });
});

describe("contrôle des acteurs", () => {
  it("réserve la récupération et la livraison au driver", () => {
    expect(checkDeliveryTransition("ASSIGNED", "PICKED_UP", "driver").ok).toBe(true);
    expect(checkDeliveryTransition("ASSIGNED", "PICKED_UP", "admin").ok).toBe(false);
    expect(checkDeliveryTransition("IN_TRANSIT", "DELIVERED", "driver").ok).toBe(true);
    expect(checkDeliveryTransition("IN_TRANSIT", "DELIVERED", "merchant_owner").ok).toBe(false);
  });

  it("interdit à un client toute transition de livraison", () => {
    for (const status of DELIVERY_STATUSES) {
      expect(allowedNextDeliveryStatuses(status, "customer")).toHaveLength(0);
    }
  });

  it("interdit au support toute transition de livraison", () => {
    for (const status of DELIVERY_STATUSES) {
      expect(allowedNextDeliveryStatuses(status, "support_agent")).toHaveLength(0);
    }
  });

  it("interdit un saut d'étape même à un admin", () => {
    const result = checkDeliveryTransition("OFFERING", "DELIVERED", "admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNKNOWN_TRANSITION");
  });

  it("laisse le driver rendre une course acceptée", () => {
    expect(checkDeliveryTransition("ASSIGNED", "UNASSIGNED", "driver").ok).toBe(true);
  });
});

describe("assertDeliveryTransition", () => {
  it("renvoie la transition quand elle est permise", () => {
    expect(assertDeliveryTransition("PICKED_UP", "IN_TRANSIT", "driver").to).toBe("IN_TRANSIT");
  });

  it("lève une DeliveryTransitionError sinon", () => {
    expect(() => assertDeliveryTransition("DELIVERED", "CANCELLED", "admin")).toThrow(
      DeliveryTransitionError,
    );
  });

  it("distingue transition inexistante et acteur non autorisé", () => {
    try {
      assertDeliveryTransition("ASSIGNED", "PICKED_UP", "admin");
      expect.unreachable();
    } catch (error) {
      expect((error as DeliveryTransitionError).code).toBe("ACTOR_NOT_ALLOWED");
    }
  });
});
