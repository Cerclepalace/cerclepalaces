import { describe, expect, it } from "vitest";

import {
  canReceiveOffers,
  changeAvailability,
  isDispatchable,
  totalSecondsIn,
  type AvailabilityPeriod,
} from "./availability.js";

const T0 = new Date("2026-06-01T18:00:00Z");
const plus = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

describe("ONLINE veut dire « joignable », jamais « obligé »", () => {
  it("ne rend joignable que ONLINE", () => {
    expect(canReceiveOffers("ONLINE")).toBe(true);
    expect(canReceiveOffers("PAUSED")).toBe(false);
    expect(canReceiveOffers("OFFLINE")).toBe(false);
  });

  it("exige aussi une vérification approuvée", () => {
    expect(isDispatchable({ verification: "APPROVED", availability: "ONLINE" })).toBe(true);
    expect(isDispatchable({ verification: "UNDER_REVIEW", availability: "ONLINE" })).toBe(false);
    expect(isDispatchable({ verification: "SUSPENDED", availability: "ONLINE" })).toBe(false);
    expect(isDispatchable({ verification: "APPROVED", availability: "OFFLINE" })).toBe(false);
  });
});

describe("changement d'état", () => {
  it("clôt la période précédente et en ouvre une nouvelle", () => {
    const courante: AvailabilityPeriod = { status: "OFFLINE", startedAt: T0 };
    const changement = changeAvailability({ current: courante, next: "ONLINE", now: plus(30) });

    expect(changement.changed).toBe(true);
    expect(changement.closing).toEqual({ startedAt: T0, endedAt: plus(30) });
    expect(changement.opening).toEqual({ status: "ONLINE", startedAt: plus(30) });
  });

  it("ne réécrit rien quand l'état ne change pas", () => {
    const courante: AvailabilityPeriod = { status: "ONLINE", startedAt: T0 };
    const changement = changeAvailability({ current: courante, next: "ONLINE", now: plus(10) });

    expect(changement.changed).toBe(false);
    expect(changement.closing).toBeUndefined();
    expect(changement.opening.startedAt).toEqual(T0);
  });

  it("ouvre une première période sans rien clore", () => {
    const changement = changeAvailability({ current: null, next: "ONLINE", now: T0 });
    expect(changement.closing).toBeUndefined();
    expect(changement.opening).toEqual({ status: "ONLINE", startedAt: T0 });
  });

  it("autorise toutes les bascules — le driver est maître de sa disponibilité", () => {
    for (const de of ["OFFLINE", "ONLINE", "PAUSED"] as const) {
      for (const vers of ["OFFLINE", "ONLINE", "PAUSED"] as const) {
        expect(() =>
          changeAvailability({ current: { status: de, startedAt: T0 }, next: vers, now: plus(5) }),
        ).not.toThrow();
      }
    }
  });
});

describe("mesure de l'offre réelle", () => {
  const périodes: readonly AvailabilityPeriod[] = [
    { status: "ONLINE", startedAt: T0, endedAt: plus(60) },
    { status: "PAUSED", startedAt: plus(60), endedAt: plus(75) },
    { status: "ONLINE", startedAt: plus(75), endedAt: plus(120) },
  ];

  it("cumule le temps passé dans un état", () => {
    const secondes = totalSecondsIn(périodes, "ONLINE", { from: T0, until: plus(120) });
    expect(secondes).toBe((60 + 45) * 60);
  });

  it("compte une période encore ouverte jusqu'à la borne", () => {
    const secondes = totalSecondsIn([{ status: "ONLINE", startedAt: T0 }], "ONLINE", {
      from: T0,
      until: plus(30),
    });
    expect(secondes).toBe(30 * 60);
  });

  it("borne une période qui déborde de la fenêtre", () => {
    const secondes = totalSecondsIn(périodes, "ONLINE", { from: plus(30), until: plus(90) });
    expect(secondes).toBe((30 + 15) * 60);
  });

  it("ignore une période entièrement hors fenêtre", () => {
    expect(totalSecondsIn(périodes, "ONLINE", { from: plus(200), until: plus(300) })).toBe(0);
  });

  it("distingue PAUSED de OFFLINE dans les statistiques", () => {
    expect(totalSecondsIn(périodes, "PAUSED", { from: T0, until: plus(120) })).toBe(15 * 60);
    expect(totalSecondsIn(périodes, "OFFLINE", { from: T0, until: plus(120) })).toBe(0);
  });
});
