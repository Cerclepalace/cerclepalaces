/**
 * Le planificateur de dispatch, sans base.
 *
 * Ce qui est vérifié ici n'est pas la qualité des décisions — le moteur a ses
 * propres tests, purs — mais la couture : les bonnes lectures sont faites, dans
 * la bonne zone, et rien n'est décidé au passage.
 */

import { DEFAULT_DELIVERY_CATEGORY, tenantScope } from "@cbd/domain";
import { describe, expect, it } from "vitest";

import type { DispatchContext, DispatchContextReader } from "./dispatch-context.js";
import { dispatchDelivery } from "./dispatch-planner.js";
import type { DriverRecord, DriverRepository } from "./repository.js";
import { FakeDeliveryStore, aDelivery } from "./store.fake.js";
import { PICKUP, plus } from "./test-helpers.js";

const shop = tenantScope("mer_a");
const ZONE = "paris-centre";

function aDriver(overrides: Partial<DriverRecord> = {}): DriverRecord {
  return {
    id: "drv_1",
    userId: "usr_1",
    verification: "APPROVED",
    availability: "ONLINE",
    zoneIds: [ZONE],
    position: { lat: 48.8687, lng: 2.3653 }, // ~200 m du shop
    activeDeliveries: 0,
    supportedCategories: [DEFAULT_DELIVERY_CATEGORY],
    ...overrides,
  };
}

/** Retient la zone demandée : c'est elle qui prouve que le contexte est suivi. */
class FakeDrivers implements DriverRepository {
  zonesDemandées: string[] = [];

  constructor(private readonly parZone: ReadonlyMap<string, readonly DriverRecord[]>) {}

  async findById(): Promise<DriverRecord | null> {
    return null;
  }
  async findByUserId(): Promise<DriverRecord | null> {
    return null;
  }
  async listDispatchableInZone(zoneId: string): Promise<readonly DriverRecord[]> {
    this.zonesDemandées.push(zoneId);
    return this.parZone.get(zoneId) ?? [];
  }
  async setAvailability(): Promise<void> {}
}

const contextReader = (context: DispatchContext): DispatchContextReader => ({
  async read() {
    return context;
  },
});

const contexteNominal = (roundsRun = 0): DispatchContext => ({
  ok: true,
  pickup: PICKUP,
  pickupZoneId: ZONE,
  roundsRun,
});

describe("préparation du tour", () => {
  it("cherche les drivers dans la zone de retrait, pas ailleurs", async () => {
    const drivers = new FakeDrivers(new Map([[ZONE, [aDriver()]]]));
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]);

    await dispatchDelivery(
      { store, drivers, context: contextReader(contexteNominal()) },
      shop,
      { deliveryId: "dlv_1", now: plus(0) },
    );

    expect(drivers.zonesDemandées).toEqual([ZONE]);
  });

  it("propose la course au driver de la zone", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]);
    const résultat = await dispatchDelivery(
      {
        store,
        drivers: new FakeDrivers(new Map([[ZONE, [aDriver({ id: "drv_proche" })]]])),
        context: contextReader(contexteNominal()),
      },
      shop,
      { deliveryId: "dlv_1", now: plus(0) },
    );

    expect(résultat).toMatchObject({
      kind: "RAN",
      outcome: { kind: "OFFERS_CREATED", offered: ["drv_proche"] },
    });
    expect(store.get("dlv_1")?.status).toBe("OFFERING");
  });

  it("transmet le nombre de tours déjà joués au moteur", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]);
    // Cinq tours joués : la politique par défaut s'arrête là.
    const résultat = await dispatchDelivery(
      {
        store,
        drivers: new FakeDrivers(new Map([[ZONE, [aDriver()]]])),
        context: contextReader(contexteNominal(5)),
      },
      shop,
      { deliveryId: "dlv_1", now: plus(0) },
    );

    expect(résultat).toMatchObject({ kind: "RAN", outcome: { kind: "EXHAUSTED" } });
  });
});

describe("livraison non dispatchable", () => {
  it("le dit plutôt que d'échouer, quand la livraison est introuvable", async () => {
    const résultat = await dispatchDelivery(
      {
        store: new FakeDeliveryStore(),
        drivers: new FakeDrivers(new Map()),
        context: contextReader({ ok: false, reason: "DELIVERY_NOT_FOUND" }),
      },
      shop,
      { deliveryId: "dlv_inconnu", now: plus(0) },
    );

    expect(résultat).toEqual({ kind: "NOT_DISPATCHABLE", reason: "DELIVERY_NOT_FOUND" });
  });

  it("le dit aussi quand aucune zone de retrait n'est connue", async () => {
    const drivers = new FakeDrivers(new Map([[ZONE, [aDriver()]]]));
    const résultat = await dispatchDelivery(
      {
        store: new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]),
        drivers,
        context: contextReader({ ok: false, reason: "NO_PICKUP_ZONE" }),
      },
      shop,
      { deliveryId: "dlv_1", now: plus(0) },
    );

    expect(résultat).toEqual({ kind: "NOT_DISPATCHABLE", reason: "NO_PICKUP_ZONE" });
    // Et surtout : aucune lecture de driver n'a été tentée pour rien.
    expect(drivers.zonesDemandées).toEqual([]);
  });
});

describe("candidat non localisé", () => {
  it("est écarté, mais reste inscrit au journal avec son motif", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]);
    await dispatchDelivery(
      {
        store,
        drivers: new FakeDrivers(
          new Map([
            [
              ZONE,
              [aDriver({ id: "drv_perdu", position: null }), aDriver({ id: "drv_situé" })],
            ],
          ]),
        ),
        context: contextReader(contexteNominal()),
      },
      shop,
      { deliveryId: "dlv_1", now: plus(0) },
    );

    const décisions = store.rounds.flatMap((round) => round.decisions);
    expect(décisions.find((d) => d.driverId === "drv_perdu")).toMatchObject({
      decision: "SKIPPED",
      reason: "POSITION_UNKNOWN",
      distanceMeters: null,
    });
    expect(décisions.find((d) => d.driverId === "drv_situé")).toMatchObject({
      decision: "OFFERED",
    });
  });
});
