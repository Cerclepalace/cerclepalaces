/**
 * Vérification des adaptateurs Prisma contre un vrai PostgreSQL.
 *
 * Les suites `service.test.ts`, `regression.test.ts` et `concurrency.test.ts`
 * prouvent que **les règles** sont justes ; elles tournent sur un faux dépôt en
 * mémoire. Ce fichier prouve autre chose, et une seule chose : que les
 * adaptateurs Prisma se comportent comme le faux, et que la base tient les
 * garanties que le service suppose — atomicité, verrou optimiste, rollback,
 * étanchéité entre tenants.
 *
 * Sans base joignable, la suite est ignorée plutôt qu'échouée : un poste de
 * développement sans PostgreSQL doit pouvoir lancer `npm test`. Le prix de ce
 * choix est qu'un CI muet passerait à côté — d'où l'assertion finale de
 * `sanity`, qui échoue bruyamment si l'URL est fournie mais la base absente.
 *
 * Lancement :
 *   PROJET1_TEST_DATABASE_URL=postgresql://... npm run test -w @cbd/api
 */

import { createPrismaClient, type PrismaClient } from "@cbd/db";
import { tenantScope, type TenantScope } from "@cbd/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DeliveryConflictError,
  respondToAssignment,
  runDispatchRound,
  transitionDelivery,
} from "./service.js";
import { createDispatchContextReader } from "./dispatch-context.js";
import { dispatchDelivery } from "./dispatch-planner.js";
import { createDriverRepository } from "../drivers/prisma-repository.js";
import { createDeliveryStore } from "./prisma-repository.js";
import { buildTestState, driver, plus, T0 } from "./test-helpers.js";

const DATABASE_URL = process.env["PROJET1_TEST_DATABASE_URL"];

/** Préfixe unique par exécution : deux runs concurrents ne se marchent pas dessus. */
const RUN = `it${Date.now().toString(36)}`;
const id = (suffix: string): string => `${RUN}_${suffix}`;

const MERCHANT_A = id("mer_a");
const MERCHANT_B = id("mer_b");
const DRIVER_1 = id("drv_1");
const DRIVER_2 = id("drv_2");
const ZONE = id("zon");

describe.skipIf(DATABASE_URL === undefined)("adaptateurs Prisma sur PostgreSQL réel", () => {
  let prisma: PrismaClient;
  let store: ReturnType<typeof createDeliveryStore>;
  let scopeA: TenantScope;
  let scopeB: TenantScope;

  /** Compteur local : chaque test travaille sur sa propre livraison. */
  let sequence = 0;

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL);
    store = createDeliveryStore(prisma);
    scopeA = tenantScope(MERCHANT_A);
    scopeB = tenantScope(MERCHANT_B);

    await prisma.zone.create({
      data: { id: ZONE, slug: id("paris-centre"), name: "Paris Centre", city: "Paris", active: true },
    });

    for (const [merchantId, suffix] of [
      [MERCHANT_A, "a"],
      [MERCHANT_B, "b"],
    ] as const) {
      await prisma.merchant.create({
        data: {
          id: merchantId,
          legalName: `Shop ${suffix} SAS`,
          tradeName: `Shop ${suffix}`,
          status: "ACTIVE",
        },
      });
      await prisma.merchantLocation.create({
        data: {
          id: id(`loc_${suffix}`),
          merchantId,
          slug: id(`loc-${suffix}`),
          name: `Boutique ${suffix}`,
          line1: "1 place de la République",
          postalCode: "75011",
          city: "Paris",
          lat: 48.8674,
          lng: 2.3636,
          zoneId: ZONE,
        },
      });
    }

    await prisma.user.create({ data: { id: id("usr_cus"), email: `${RUN}.client@example.test` } });
    await prisma.customerProfile.create({
      data: { id: id("cus"), userId: id("usr_cus"), firstName: "Client" },
    });

    for (const [driverId, suffix] of [
      [DRIVER_1, "1"],
      [DRIVER_2, "2"],
    ] as const) {
      await prisma.user.create({
        data: { id: id(`usr_drv_${suffix}`), email: `${RUN}.driver${suffix}@example.test` },
      });
      await prisma.driver.create({
        data: {
          id: driverId,
          userId: id(`usr_drv_${suffix}`),
          firstName: `Driver ${suffix}`,
          lastName: "Test",
          phone: `+3360000000${suffix}`,
          verification: "APPROVED",
          availability: "ONLINE",
          // Positions réelles : sans elles tous les candidats seraient écartés
          // pour POSITION_UNKNOWN et les tests de dispatch ne prouveraient rien.
          lastLat: suffix === "1" ? 48.8687 : 48.8721,
          lastLng: suffix === "1" ? 2.3653 : 2.3702,
          lastSeenAt: T0,
        },
      });
      await prisma.driverZone.create({
        data: { id: id(`dz_${suffix}`), driverId, zoneId: ZONE },
      });
    }
  }, 30_000);

  afterAll(async () => {
    if (prisma === undefined) return;
    // Nettoyage dans l'ordre inverse des dépendances : les cascades couvrent
    // le reste, mais on ne s'y fie pas pour les tables transverses.
    await prisma.auditLog.deleteMany({ where: { targetId: { startsWith: RUN } } });
    await prisma.delivery.deleteMany({ where: { merchantId: { in: [MERCHANT_A, MERCHANT_B] } } });
    await prisma.order.deleteMany({ where: { merchantId: { in: [MERCHANT_A, MERCHANT_B] } } });
    await prisma.merchant.deleteMany({ where: { id: { in: [MERCHANT_A, MERCHANT_B] } } });
    await prisma.driver.deleteMany({ where: { id: { in: [DRIVER_1, DRIVER_2] } } });
    await prisma.customerProfile.deleteMany({ where: { id: id("cus") } });
    await prisma.user.deleteMany({ where: { email: { startsWith: `${RUN}.` } } });
    await prisma.zone.deleteMany({ where: { id: ZONE } });
    await prisma.$disconnect();
  }, 30_000);

  /**
   * Chaque test repart d'une base identique.
   *
   * Sans cela, la charge des drivers s'accumule d'un test à l'autre : la
   * politique par défaut n'admet qu'une course simultanée, donc une livraison
   * laissée `ASSIGNED` par un test précédent suffit à rendre un driver
   * indisponible pour le suivant, qui échoue alors pour une raison qui n'a rien
   * à voir avec ce qu'il teste.
   */
  beforeEach(async () => {
    sequence += 1;
    await prisma.order.deleteMany({ where: { merchantId: { in: [MERCHANT_A, MERCHANT_B] } } });
    await prisma.driverAvailabilityLog.deleteMany({
      where: { driverId: { in: [DRIVER_1, DRIVER_2] } },
    });
    await prisma.driver.update({
      where: { id: DRIVER_1 },
      data: { availability: "ONLINE", verification: "APPROVED", lastLat: 48.8687, lastLng: 2.3653 },
    });
    await prisma.driver.update({
      where: { id: DRIVER_2 },
      data: { availability: "ONLINE", verification: "APPROVED", lastLat: 48.8721, lastLng: 2.3702 },
    });
  });

  /** Crée commande + livraison pour le tenant demandé, dans le statut voulu. */
  async function seedDelivery(options: {
    readonly merchantId: string;
    readonly status?: "PENDING_DISPATCH" | "OFFERING" | "ASSIGNED";
    readonly assignedDriverId?: string;
  }): Promise<string> {
    const suffix = options.merchantId === MERCHANT_A ? "a" : "b";
    const deliveryId = id(`dlv_${sequence}`);
    const orderId = id(`ord_${sequence}`);

    await prisma.order.create({
      data: {
        id: orderId,
        reference: `${RUN}-${sequence}`,
        merchantId: options.merchantId,
        customerId: id("cus"),
        locationId: id(`loc_${suffix}`),
        status: "READY_FOR_PICKUP",
        // Flux du pilote : la commande est arrivée directement au shop, sans
        // confirmation extérieure. La colonne n'a pas de défaut, c'est donc au
        // créateur de le dire — y compris dans un jeu de test.
        fulfillmentMode: "MERCHANT_DIRECT",
        productsSubtotalCents: 4_000,
        deliveryFeeCents: 500,
        customerTotalCents: 4_500,
        merchantPayoutCents: 3_400,
        driverPayoutCents: 400,
        platformNetCents: 700,
      },
    });

    await prisma.delivery.create({
      data: {
        id: deliveryId,
        merchantId: options.merchantId,
        orderId,
        status: options.status ?? "PENDING_DISPATCH",
        ...(options.assignedDriverId === undefined
          ? {}
          : { assignedDriverId: options.assignedDriverId }),
        pickupZoneId: ZONE,
      },
    });

    return deliveryId;
  }

  async function offer(
    deliveryId: string,
    driverId: string,
    rank: number,
    expiresAt: Date = plus(30),
  ): Promise<string> {
    const row = await prisma.deliveryAssignment.create({
      data: { deliveryId, driverId, rank, offeredAt: T0, expiresAt },
      select: { id: true },
    });
    return row.id;
  }

  const readDelivery = (deliveryId: string) =>
    prisma.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      select: { status: true, assignedDriverId: true, version: true },
    });

  it("sanity : la base annoncée est bien joignable et migrée", async () => {
    const tables = await prisma.$queryRaw<{ count: bigint }[]>`
      select count(*)::bigint as count from information_schema.tables where table_schema = 'public'
    `;
    expect(Number(tables[0]?.count ?? 0)).toBeGreaterThan(30);

    const index = await prisma.$queryRaw<{ indexdef: string }[]>`
      select indexdef from pg_indexes where indexname = 'uniq_delivery_accepted_assignment'
    `;
    // Condition 7 : la contrainte doit exister en base, pas seulement dans le code.
    expect(index[0]?.indexdef).toContain("ACCEPTED");
  });

  describe("deux workers concurrents", () => {
    it("n'attribue la course qu'à un seul driver", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A, status: "OFFERING" });
      const asg1 = await offer(deliveryId, DRIVER_1, 1);
      const asg2 = await offer(deliveryId, DRIVER_2, 2);

      const [premier, second] = await Promise.all([
        respondToAssignment(store, scopeA, {
          assignmentId: asg1,
          driverId: DRIVER_1,
          response: "ACCEPTED",
          now: plus(5),
        }),
        respondToAssignment(store, scopeA, {
          assignmentId: asg2,
          driverId: DRIVER_2,
          response: "ACCEPTED",
          now: plus(5),
        }),
      ]);

      const issues = [premier.kind, second.kind].sort();
      expect(issues).toEqual(["ACCEPTED", "REFUSED"]);

      const delivery = await readDelivery(deliveryId);
      expect(delivery.status).toBe("ASSIGNED");
      expect(delivery.version).toBe(1);
      expect([DRIVER_1, DRIVER_2]).toContain(delivery.assignedDriverId);

      const accepted = await prisma.deliveryAssignment.count({
        where: { deliveryId, status: "ACCEPTED" },
      });
      expect(accepted).toBe(1);

      // Le perdant n'a laissé aucune trace d'historique : sa transaction n'a
      // rien écrit avant de se voir refuser.
      const events = await prisma.deliveryStatusEvent.count({
        where: { deliveryId, toStatus: "ASSIGNED" },
      });
      expect(events).toBe(1);
    });

    it("annule tout le tour de dispatch perdant, offres comprises", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A });
      const candidates = [
        driver({ driverId: DRIVER_1, zoneIds: [ZONE] }),
        driver({ driverId: DRIVER_2, zoneIds: [ZONE] }),
      ];

      // Deux workers ouvrent le même premier tour. Le numéro de tour diffère
      // pour que ce soit bien le verrou optimiste qui tranche, et non l'unicité
      // `(deliveryId, roundNumber)` — les deux protègent, on isole ici la garde
      // applicative (findings C1/D1).
      const outcomes = await Promise.allSettled([
        runDispatchRound(store, scopeA, {
          deliveryId,
          buildState: buildTestState(candidates, 0),
          now: plus(1),
        }),
        runDispatchRound(store, scopeA, {
          deliveryId,
          buildState: buildTestState(candidates, 1),
          now: plus(1),
        }),
      ]);

      const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: expect.any(DeliveryConflictError),
      });

      const delivery = await readDelivery(deliveryId);
      expect(delivery.status).toBe("OFFERING");
      expect(delivery.version).toBe(1);

      // Le rollback est la seule chose que ce test prouve vraiment : le
      // perdant avait déjà écrit propositions et tour de dispatch avant de se
      // heurter au verrou. Rien ne doit en rester.
      expect(await prisma.deliveryAssignment.count({ where: { deliveryId } })).toBe(1);
      expect(await prisma.dispatchRound.count({ where: { deliveryId } })).toBe(1);
      expect(await prisma.dispatchDecision.count({ where: { deliveryId } })).toBe(2);
    });
  });

  describe("A accepte, A se désiste, B accepte", () => {
    it("réattribue la course au second driver", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A, status: "OFFERING" });
      const asgA = await offer(deliveryId, DRIVER_1, 1);

      const acceptation = await respondToAssignment(store, scopeA, {
        assignmentId: asgA,
        driverId: DRIVER_1,
        response: "ACCEPTED",
        now: plus(5),
      });
      expect(acceptation.kind).toBe("ACCEPTED");

      // Désistement : la course repart au dispatch et le driver est libéré.
      await transitionDelivery(store, scopeA, {
        deliveryId,
        toStatus: "UNASSIGNED",
        actor: "driver",
        actorUserId: null,
      });

      const rendue = await readDelivery(deliveryId);
      expect(rendue.status).toBe("UNASSIGNED");
      expect(rendue.assignedDriverId).toBeNull();

      await transitionDelivery(store, scopeA, {
        deliveryId,
        toStatus: "OFFERING",
        actor: "system",
        actorUserId: null,
      });

      const asgB = await offer(deliveryId, DRIVER_2, 2, plus(120));
      const reprise = await respondToAssignment(store, scopeA, {
        assignmentId: asgB,
        driverId: DRIVER_2,
        response: "ACCEPTED",
        now: plus(60),
      });
      expect(reprise.kind).toBe("ACCEPTED");

      const finale = await readDelivery(deliveryId);
      expect(finale.status).toBe("ASSIGNED");
      expect(finale.assignedDriverId).toBe(DRIVER_2);

      // L'historique reste lisible : on sait que le premier driver avait
      // accepté puis rendu la course.
      const historique = await prisma.deliveryAssignment.findMany({
        where: { deliveryId },
        select: { driverId: true, status: true, acceptedAt: true },
        orderBy: { rank: "asc" },
      });
      expect(historique).toHaveLength(2);
      expect(historique[0]?.acceptedAt).not.toBeNull();
    });
  });

  describe("libération du driver et invalidation des offres", () => {
    it("détache le driver et annule les offres ouvertes sur annulation", async () => {
      const deliveryId = await seedDelivery({
        merchantId: MERCHANT_A,
        status: "ASSIGNED",
        assignedDriverId: DRIVER_1,
      });
      const ouverte = await offer(deliveryId, DRIVER_2, 2);

      await transitionDelivery(store, scopeA, {
        deliveryId,
        toStatus: "CANCELLED",
        actor: "system",
        actorUserId: null,
      });

      const delivery = await readDelivery(deliveryId);
      expect(delivery.status).toBe("CANCELLED");
      expect(delivery.assignedDriverId).toBeNull();

      const restante = await prisma.deliveryAssignment.findUniqueOrThrow({
        where: { id: ouverte },
        select: { status: true },
      });
      expect(restante.status).toBe("CANCELLED");
    });
  });

  describe("transition illégale", () => {
    it("laisse la base intacte", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A });

      await expect(
        transitionDelivery(store, scopeA, {
          deliveryId,
          toStatus: "DELIVERED",
          actor: "driver",
          actorUserId: null,
        }),
      ).rejects.toThrow();

      const delivery = await readDelivery(deliveryId);
      expect(delivery.status).toBe("PENDING_DISPATCH");
      expect(delivery.version).toBe(0);
      expect(await prisma.deliveryStatusEvent.count({ where: { deliveryId } })).toBe(0);
    });
  });

  describe("idempotence", () => {
    it("rejouer la même transition n'écrit pas un second événement", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A });

      await transitionDelivery(store, scopeA, {
        deliveryId,
        toStatus: "OFFERING",
        actor: "system",
        actorUserId: null,
      });
      await transitionDelivery(store, scopeA, {
        deliveryId,
        toStatus: "OFFERING",
        actor: "system",
        actorUserId: null,
      });

      const delivery = await readDelivery(deliveryId);
      expect(delivery.version).toBe(1);
      expect(await prisma.deliveryStatusEvent.count({ where: { deliveryId } })).toBe(1);
    });
  });

  describe("étanchéité entre tenants", () => {
    it("ne laisse pas un shop voir ni modifier la livraison d'un autre", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A });

      await expect(
        transitionDelivery(store, scopeB, {
          deliveryId,
          toStatus: "OFFERING",
          actor: "system",
          actorUserId: null,
        }),
      ).rejects.toThrow();

      const delivery = await readDelivery(deliveryId);
      expect(delivery.status).toBe("PENDING_DISPATCH");
      expect(delivery.version).toBe(0);
    });

    it("ne laisse pas répondre à une proposition d'un autre shop", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A, status: "OFFERING" });
      const asg = await offer(deliveryId, DRIVER_1, 1);

      const résultat = await respondToAssignment(store, scopeB, {
        assignmentId: asg,
        driverId: DRIVER_1,
        response: "ACCEPTED",
        now: plus(5),
      });

      expect(résultat).toMatchObject({ kind: "REFUSED", code: "NOT_FOUND" });
      const delivery = await readDelivery(deliveryId);
      expect(delivery.assignedDriverId).toBeNull();
    });
  });

  describe("contrainte de base", () => {
    it("bloque une seconde acceptation même en contournant l'application", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A, status: "OFFERING" });
      const asg1 = await offer(deliveryId, DRIVER_1, 1);
      await offer(deliveryId, DRIVER_2, 2);

      await prisma.deliveryAssignment.update({
        where: { id: asg1 },
        data: { status: "ACCEPTED", acceptedAt: plus(5) },
      });

      // SQL brut : ni le service, ni le dépôt ne sont dans le chemin. Si
      // quelque chose s'y oppose, c'est PostgreSQL.
      await expect(
        prisma.$executeRaw`
          update "DeliveryAssignment"
             set "status" = 'ACCEPTED', "acceptedAt" = now()
           where "deliveryId" = ${deliveryId} and "driverId" = ${DRIVER_2}
        `,
        // SQLSTATE 23505 : violation d'unicité, remontée telle quelle par
        // PostgreSQL. Le nom de l'index est vérifié par le test `sanity`.
      ).rejects.toMatchObject({ meta: { code: "23505" } });

      // Et l'index reste bien *partiel* : les statuts non acceptés ne sont pas
      // contraints. Sans cette seconde assertion, un simple unique sur
      // `deliveryId` passerait le test au-dessus tout en cassant le dispatch.
      const rejets = await prisma.$executeRaw`
        update "DeliveryAssignment"
           set "status" = 'REJECTED'
         where "deliveryId" = ${deliveryId} and "driverId" = ${DRIVER_2}
      `;
      expect(rejets).toBe(1);
    });
  });
  describe("dépôt driver et dispatch de bout en bout", () => {
    it("ne retient que les drivers approuvés, en ligne et dans la zone", async () => {
      const drivers = createDriverRepository(prisma);
      const trouvés = await drivers.listDispatchableInZone(ZONE);

      expect(trouvés.map((d) => d.id).sort()).toEqual([DRIVER_1, DRIVER_2].sort());
      expect(trouvés.every((d) => d.zoneIds.includes(ZONE))).toBe(true);
      expect(trouvés.every((d) => d.position !== null)).toBe(true);
      // Zone inconnue : pas d'erreur, une liste vide.
      expect(await drivers.listDispatchableInZone("zone-qui-n-existe-pas")).toEqual([]);
    });

    it("compte comme charge les seules courses qui mobilisent le driver", async () => {
      const drivers = createDriverRepository(prisma);
      expect((await drivers.findById(DRIVER_1))?.activeDeliveries).toBe(0);

      // Une course en cours compte.
      await seedDelivery({
        merchantId: MERCHANT_A,
        status: "ASSIGNED",
        assignedDriverId: DRIVER_1,
      });
      expect((await drivers.findById(DRIVER_1))?.activeDeliveries).toBe(1);

      // Une course livrée, où il reste attaché pour la traçabilité, ne compte pas.
      sequence += 1;
      const livrée = await seedDelivery({
        merchantId: MERCHANT_A,
        status: "ASSIGNED",
        assignedDriverId: DRIVER_1,
      });
      await prisma.delivery.update({ where: { id: livrée }, data: { status: "DELIVERED" } });
      expect((await drivers.findById(DRIVER_1))?.activeDeliveries).toBe(1);
    });

    it("clôt la période de disponibilité précédente en en ouvrant une nouvelle", async () => {
      const drivers = createDriverRepository(prisma);

      await drivers.setAvailability({ driverId: DRIVER_2, availability: "ONLINE", now: T0 });
      await drivers.setAvailability({ driverId: DRIVER_2, availability: "PAUSED", now: plus(600) });

      const périodes = await prisma.driverAvailabilityLog.findMany({
        where: { driverId: DRIVER_2 },
        orderBy: { startedAt: "asc" },
        select: { status: true, startedAt: true, endedAt: true },
      });

      expect(périodes).toHaveLength(2);
      expect(périodes[0]).toMatchObject({ status: "ONLINE" });
      expect(périodes[0]?.endedAt).not.toBeNull();
      expect(périodes[1]).toMatchObject({ status: "PAUSED", endedAt: null });

      // Passer hors ligne ferme la période courante sans en ouvrir une autre :
      // l'absence n'est pas une présence à mesurer.
      await drivers.setAvailability({ driverId: DRIVER_2, availability: "OFFLINE", now: plus(900) });
      const après = await prisma.driverAvailabilityLog.findMany({ where: { driverId: DRIVER_2 } });
      expect(après).toHaveLength(2);
      expect(après.every((période) => période.endedAt !== null)).toBe(true);

    });

    it("lit le point de retrait sur la boutique, pas sur la livraison", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A });
      const contexte = await createDispatchContextReader(prisma).read(scopeA, deliveryId);

      expect(contexte).toMatchObject({
        ok: true,
        pickup: { lat: 48.8674, lng: 2.3636 },
        pickupZoneId: ZONE,
        roundsRun: 0,
      });
    });

    it("hérite la zone de la boutique quand la livraison n'en fige aucune", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A });
      await prisma.delivery.update({ where: { id: deliveryId }, data: { pickupZoneId: null } });

      const contexte = await createDispatchContextReader(prisma).read(scopeA, deliveryId);
      expect(contexte).toMatchObject({ ok: true, pickupZoneId: ZONE });
    });

    it("ne laisse pas un shop lire le contexte de dispatch d'un autre", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A });
      const contexte = await createDispatchContextReader(prisma).read(scopeB, deliveryId);
      expect(contexte).toEqual({ ok: false, reason: "DELIVERY_NOT_FOUND" });
    });

    it("mène un tour complet : lecture des candidats, offre, journal", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A });
      const deps = {
        store,
        drivers: createDriverRepository(prisma),
        context: createDispatchContextReader(prisma),
      };

      const résultat = await dispatchDelivery(deps, scopeA, { deliveryId, now: plus(0) });

      expect(résultat.kind).toBe("RAN");
      if (résultat.kind !== "RAN") return;
      expect(résultat.outcome.kind).toBe("OFFERS_CREATED");

      const delivery = await readDelivery(deliveryId);
      expect(delivery.status).toBe("OFFERING");

      // Le driver le plus proche du shop reçoit l'offre.
      const propositions = await prisma.deliveryAssignment.findMany({
        where: { deliveryId },
        select: { driverId: true, rank: true },
      });
      expect(propositions).toHaveLength(1);
      expect(propositions[0]?.driverId).toBe(DRIVER_1);

      // Et l'autre candidat est journalisé, écarté mais visible : c'est ce qui
      // permettra de répondre plus tard à « pourquoi pas lui ».
      const décisions = await prisma.dispatchDecision.findMany({
        where: { deliveryId },
        select: { driverId: true, decision: true, reason: true, distanceMeters: true },
      });
      expect(décisions).toHaveLength(2);
      const écarté = décisions.find((d) => d.driverId === DRIVER_2);
      expect(écarté).toMatchObject({ decision: "SKIPPED", reason: "NOT_SELECTED_THIS_ROUND" });
      expect(écarté?.distanceMeters).toBeGreaterThan(0);
    });

    it("écarte un driver non localisé avec un motif, sans le rendre invisible", async () => {
      await prisma.driver.update({
        where: { id: DRIVER_1 },
        data: { lastLat: null, lastLng: null },
      });

      {
        const deliveryId = await seedDelivery({ merchantId: MERCHANT_A });
        const résultat = await dispatchDelivery(
          {
            store,
            drivers: createDriverRepository(prisma),
            context: createDispatchContextReader(prisma),
          },
          scopeA,
          { deliveryId, now: plus(0) },
        );

        expect(résultat).toMatchObject({
          kind: "RAN",
          outcome: { kind: "OFFERS_CREATED", offered: [DRIVER_2] },
        });

        const décision = await prisma.dispatchDecision.findFirst({
          where: { deliveryId, driverId: DRIVER_1 },
          select: { decision: true, reason: true, distanceMeters: true },
        });
        expect(décision).toMatchObject({
          decision: "SKIPPED",
          reason: "POSITION_UNKNOWN",
          distanceMeters: null,
        });
      }
    });
  });
  describe("mode de libération en base", () => {
    it("refuse une commande qui ne dit pas de quel flux elle relève", async () => {
      // La colonne est NOT NULL sans défaut : PostgreSQL a le dernier mot, même
      // si le typage était contourné.
      await expect(
        prisma.$executeRaw`
          insert into "Order" ("id", "reference", "merchantId", "customerId", "locationId",
                               "status", "productsSubtotalCents", "deliveryFeeCents",
                               "customerTotalCents", "merchantPayoutCents",
                               "driverPayoutCents", "platformNetCents", "updatedAt")
          values (${id("ord_sans_mode")}, ${`${RUN}-sans-mode`}, ${MERCHANT_A}, ${id("cus")},
                  ${id("loc_a")}, 'CART', 100, 0, 100, 100, 0, 0, now())
        `,
      ).rejects.toMatchObject({ meta: { code: "23502" } });
    });

    it("relit le mode tel qu'il a été écrit", async () => {
      const deliveryId = await seedDelivery({ merchantId: MERCHANT_A });
      const order = await prisma.delivery.findUniqueOrThrow({
        where: { id: deliveryId },
        select: { order: { select: { fulfillmentMode: true } } },
      });
      expect(order.order.fulfillmentMode).toBe("MERCHANT_DIRECT");
    });

    it("n'accepte que les deux valeurs déclarées", async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `update "Order" set "fulfillmentMode" = 'SIMULATED' where "merchantId" = $1`,
          MERCHANT_A,
        ),
      ).rejects.toThrow();
    });
  });
});
