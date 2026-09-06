import { describe, expect, it } from "vitest";

import {
  eventsMatchStoredStatus,
  replayDeliveryEvents,
  statusAt,
  type ReplayableEvent,
} from "./replay.js";
import type { DeliveryStatus } from "./status.js";

const T0 = new Date("2026-06-01T18:00:00Z");
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

const journal = (
  paires: readonly (readonly [DeliveryStatus | null, DeliveryStatus])[],
): ReplayableEvent[] =>
  paires.map(([fromStatus, toStatus], i) => ({ fromStatus, toStatus, createdAt: at(i) }));

const parcoursNominal = journal([
  ["PENDING_DISPATCH", "OFFERING"],
  ["OFFERING", "ASSIGNED"],
  ["ASSIGNED", "PICKED_UP"],
  ["PICKED_UP", "IN_TRANSIT"],
  ["IN_TRANSIT", "DELIVERED"],
]);

// SCÉNARIO 10 de la spec : rejeu et déterminisme.
describe("rejeu du journal", () => {
  it("reconstitue l'état final d'un parcours nominal", () => {
    const résultat = replayDeliveryEvents(parcoursNominal);
    expect(résultat.ok).toBe(true);
    if (résultat.ok) {
      expect(résultat.finalStatus).toBe("DELIVERED");
      expect(résultat.steps).toBe(5);
    }
  });

  it("est parfaitement déterministe", () => {
    const résultats = Array.from({ length: 20 }, () => replayDeliveryEvents(parcoursNominal));
    const référence = JSON.stringify(résultats[0]);
    for (const r of résultats) expect(JSON.stringify(r)).toBe(référence);
  });

  it("reconstitue un parcours avec réassignation", () => {
    const résultat = replayDeliveryEvents(
      journal([
        ["PENDING_DISPATCH", "OFFERING"],
        ["OFFERING", "ASSIGNED"],
        ["ASSIGNED", "UNASSIGNED"],
        ["UNASSIGNED", "OFFERING"],
        ["OFFERING", "ASSIGNED"],
        ["ASSIGNED", "PICKED_UP"],
        ["PICKED_UP", "IN_TRANSIT"],
        ["IN_TRANSIT", "DELIVERED"],
      ]),
    );
    expect(résultat.ok).toBe(true);
    if (résultat.ok) expect(résultat.finalStatus).toBe("DELIVERED");
  });

  it("accepte un premier événement sans état de départ", () => {
    const résultat = replayDeliveryEvents(journal([[null, "OFFERING"]]));
    expect(résultat.ok).toBe(true);
  });
});

describe("détection d'incohérences", () => {
  it("repère un trou : un état a changé sans laisser de trace", () => {
    const résultat = replayDeliveryEvents(
      journal([
        ["PENDING_DISPATCH", "OFFERING"],
        // ASSIGNED manquant
        ["PICKED_UP", "IN_TRANSIT"],
      ]),
    );
    expect(résultat.ok).toBe(false);
    if (!résultat.ok) {
      expect(résultat.code).toBe("GAP");
      expect(résultat.atIndex).toBe(1);
    }
  });

  it("repère une transition absente de la table", () => {
    const résultat = replayDeliveryEvents(
      journal([
        ["PENDING_DISPATCH", "OFFERING"],
        ["OFFERING", "PICKED_UP"],
      ]),
    );
    expect(résultat.ok).toBe(false);
    if (!résultat.ok) expect(résultat.code).toBe("ILLEGAL_TRANSITION");
  });

  it("repère un événement après un état terminal", () => {
    const résultat = replayDeliveryEvents([
      ...parcoursNominal,
      { fromStatus: "DELIVERED", toStatus: "CANCELLED", createdAt: at(9) },
    ]);
    expect(résultat.ok).toBe(false);
    if (!résultat.ok) expect(résultat.code).toBe("AFTER_TERMINAL");
  });

  it("signale un journal vide plutôt que d'inventer un état", () => {
    const résultat = replayDeliveryEvents([]);
    expect(résultat.ok).toBe(false);
    if (!résultat.ok) expect(résultat.code).toBe("EMPTY");
  });
});

describe("cohérence journal / état stocké", () => {
  it("valide un état stocké conforme", () => {
    expect(eventsMatchStoredStatus(parcoursNominal, "DELIVERED")).toBe(true);
  });

  it("détecte un état stocké qui ne correspond pas au journal", () => {
    // Quelqu'un a écrit IN_TRANSIT en base sans passer par le service.
    expect(eventsMatchStoredStatus(parcoursNominal, "IN_TRANSIT")).toBe(false);
  });

  it("détecte un journal incohérent quel que soit l'état stocké", () => {
    const cassé = journal([
      ["PENDING_DISPATCH", "OFFERING"],
      ["OFFERING", "DELIVERED"],
    ]);
    expect(eventsMatchStoredStatus(cassé, "DELIVERED")).toBe(false);
  });
});

describe("état à un instant donné", () => {
  it("retrouve l'état à une date passée", () => {
    expect(statusAt(parcoursNominal, at(0))).toBe("OFFERING");
    expect(statusAt(parcoursNominal, at(2))).toBe("PICKED_UP");
    expect(statusAt(parcoursNominal, at(4))).toBe("DELIVERED");
  });

  it("renvoie l'état initial avant le premier événement", () => {
    expect(statusAt(parcoursNominal, new Date(T0.getTime() - 1000))).toBe("PENDING_DISPATCH");
  });

  it("renvoie l'état final bien après le dernier événement", () => {
    expect(statusAt(parcoursNominal, at(999))).toBe("DELIVERED");
  });
});
