/**
 * Service de livraison — le seul écrivain d'un statut de livraison.
 *
 * Même contrat que le service de commande : une transition acceptée produit
 * **indissociablement** le statut, son événement d'historique et, quand
 * l'action est sensible, sa trace d'audit — le tout dans une seule transaction.
 *
 * Trois gardes s'empilent, et aucune ne remplace les autres :
 *
 *   1. `TenantScope` — la requête ne peut atteindre que les livraisons du shop.
 *   2. `assertDeliveryTransition` — la transition existe et l'acteur y a droit.
 *   3. `Delivery.version` — deux écritures concurrentes ne s'écrasent pas.
 *
 * Le moteur de dispatch reste pur : il décide, ce service écrit. L'horloge est
 * un paramètre, jamais lue ici.
 */

import {
  assertDeliveryTransition,
  isTerminalDeliveryStatus,
  nextOffer,
  respondToOffer,
  type Actor,
  type Assignment,
  type DeliveryStatus,
  type DispatchState,
  type TenantScope,
} from "@cbd/domain";

import type {
  AssignmentRecord,
  DeliveryRepository,
  DeliverySnapshot,
  DeliveryTransactionalStore,
} from "./repository.js";

export class DeliveryNotFoundError extends Error {
  readonly status = 404;
  constructor(deliveryId: string) {
    // Message volontairement identique qu'il s'agisse d'une livraison
    // inexistante ou d'une livraison d'un autre tenant : distinguer les deux
    // permettrait d'énumérer les livraisons des concurrents.
    super(`Livraison ${deliveryId} introuvable.`);
    this.name = "DeliveryNotFoundError";
  }
}

export class DeliveryConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "DeliveryConflictError";
  }
}

/** Transitions dont la trace d'audit est obligatoire. */
const AUDITED_TARGETS: readonly DeliveryStatus[] = [
  "DELIVERED",
  "FAILED",
  "CANCELLED",
  "UNASSIGNED",
];

/**
 * États où la course n'a plus de driver légitime.
 *
 * `DELIVERED` en est délibérément absent : le driver a fait la course, il doit
 * rester attaché pour le payout et la traçabilité. Partout ailleurs, laisser
 * `assignedDriverId` renseigné donnerait un accès résiduel — `guard.ts` accorde
 * la lecture d'une commande sur ce champ.
 */
const RELEASES_DRIVER: readonly DeliveryStatus[] = [
  "UNASSIGNED",
  "CANCELLED",
  "FAILED",
];

/**
 * États où les propositions encore vivantes n'ont plus d'objet.
 *
 * Deux cas y sont clos, et pas un seul :
 *
 *  - les propositions encore `OFFERED` — sans quoi un driver peut recevoir puis
 *    accepter une offre sur une course annulée : le verrou de version le
 *    bloquerait, mais avec un message trompeur, et rien ne le bloquerait si
 *    l'offre était rejouée plus tard ;
 *  - la proposition `ACCEPTED` du driver qui vient d'être libéré. Elle décrit
 *    une propriété qui n'existe plus. La laisser ouverte rendait toute
 *    réassignation impossible en base : l'index partiel
 *    `uniq_delivery_accepted_assignment` n'admet qu'une acceptation vivante par
 *    livraison, et la seconde acceptation était rejetée par PostgreSQL —
 *    divergence constatée en intégration, pas en théorie.
 *
 * Clore n'est pas réécrire l'histoire : `acceptedAt` reste renseigné. Une
 * proposition `CANCELLED` portant un `acceptedAt` se lit exactement pour ce
 * qu'elle est — « ce driver avait accepté, puis la course lui a été retirée ».
 */
const CLOSES_LIVE_ASSIGNMENTS: readonly DeliveryStatus[] = [
  "UNASSIGNED",
  "CANCELLED",
  "FAILED",
];

/** Statuts de proposition qui engagent encore quelqu'un. */
const LIVE_ASSIGNMENT_STATUSES: readonly string[] = ["OFFERED", "ACCEPTED"];

export interface DeliveryTransitionCommand {
  readonly deliveryId: string;
  readonly toStatus: DeliveryStatus;
  readonly actor: Actor;
  readonly actorUserId: string | null;
  /** Renseigné uniquement quand la transition assigne ou libère un driver. */
  readonly assignedDriverId?: string | null;
}

export interface DeliveryTransitionResult {
  readonly deliveryId: string;
  readonly fromStatus: DeliveryStatus;
  readonly toStatus: DeliveryStatus;
}

/**
 * Applique une transition de statut de livraison.
 */
export async function transitionDelivery(
  store: DeliveryTransactionalStore,
  scope: TenantScope,
  command: DeliveryTransitionCommand,
): Promise<DeliveryTransitionResult> {
  if (command.actor === "system" && command.actorUserId !== null) {
    throw new DeliveryConflictError("L'acteur système ne peut pas porter d'utilisateur.");
  }

  return store.runInTransaction(async (repo) => {
    const delivery = await repo.findById(scope, command.deliveryId);
    if (!delivery) throw new DeliveryNotFoundError(command.deliveryId);

    if (isTerminalDeliveryStatus(delivery.status)) {
      throw new DeliveryConflictError(
        `La livraison est en état terminal (${delivery.status}) : plus aucune transition n'est possible.`,
      );
    }

    // Idempotence : rejouer la même transition ne produit pas un second
    // événement d'historique.
    if (delivery.status === command.toStatus) {
      return {
        deliveryId: delivery.id,
        fromStatus: delivery.status,
        toStatus: delivery.status,
      };
    }

    const transition = assertDeliveryTransition(delivery.status, command.toStatus, command.actor);

    // La libération du driver n'est pas laissée à l'appelant : un oubli
    // laisserait un accès résiduel sur une course qu'il ne fait plus.
    const releasesDriver = RELEASES_DRIVER.includes(command.toStatus);

    const written = await repo.updateStatus(scope, {
      deliveryId: delivery.id,
      expectedVersion: delivery.version,
      toStatus: command.toStatus,
      ...(releasesDriver
        ? { assignedDriverId: null }
        : command.assignedDriverId !== undefined
          ? { assignedDriverId: command.assignedDriverId }
          : {}),
    });

    if (!written) {
      throw new DeliveryConflictError(
        "La livraison a été modifiée entre-temps. Recharger et réessayer.",
      );
    }

    if (CLOSES_LIVE_ASSIGNMENTS.includes(command.toStatus)) {
      const existantes = await repo.listAssignments(scope, delivery.id);
      for (const assignment of existantes) {
        if (!LIVE_ASSIGNMENT_STATUSES.includes(assignment.status)) continue;
        // Pas de `respondedAt` : personne n'a répondu, la plateforme a clos.
        await repo.updateAssignmentStatus(scope, {
          assignmentId: assignment.id,
          toStatus: "CANCELLED",
        });
      }
    }

    await repo.appendStatusEvent(scope, {
      deliveryId: delivery.id,
      fromStatus: delivery.status,
      toStatus: command.toStatus,
      actorRole: command.actor,
      actorId: command.actorUserId,
      reason: transition.reason,
    });

    if (AUDITED_TARGETS.includes(command.toStatus)) {
      await repo.appendAuditEntry(scope, {
        actorUserId: command.actorUserId,
        actorRole: command.actor,
        action: `delivery.transition.${command.toStatus.toLowerCase()}`,
        targetType: "Delivery",
        targetId: delivery.id,
        metadata: { fromStatus: delivery.status, toStatus: command.toStatus },
      });
    }

    return {
      deliveryId: delivery.id,
      fromStatus: delivery.status,
      toStatus: command.toStatus,
    };
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const toAssignment = (record: AssignmentRecord): Assignment => ({
  id: record.id,
  deliveryId: record.deliveryId,
  driverId: record.driverId,
  status: record.status,
  rank: record.rank,
  offeredAt: record.offeredAt,
  expiresAt: record.expiresAt,
});

export interface RunDispatchInput {
  readonly deliveryId: string;
  /** Construit par l'appelant à partir du dépôt driver et de la livraison. */
  readonly buildState: (delivery: DeliverySnapshot, assignments: readonly Assignment[]) => DispatchState;
  readonly now: Date;
}

export type RunDispatchOutcome =
  | { readonly kind: "OFFERS_CREATED"; readonly offered: readonly string[] }
  | { readonly kind: "WAITING"; readonly until: Date }
  | { readonly kind: "EXPIRED"; readonly assignmentIds: readonly string[] }
  | { readonly kind: "EXHAUSTED" }
  | { readonly kind: "IDLE"; readonly reason: string };

/**
 * Fait tourner un tour de dispatch.
 *
 * Le moteur décide (fonction pure), ce service exécute. Chaque tour est
 * journalisé avec **tous** les candidats évalués et leur motif — y compris les
 * écartés. C'est ce qui permet de répondre plus tard à « pourquoi ce driver et
 * pas celui-là ».
 */
export async function runDispatchRound(
  store: DeliveryTransactionalStore,
  scope: TenantScope,
  input: RunDispatchInput,
): Promise<RunDispatchOutcome> {
  return store.runInTransaction(async (repo) => {
    const delivery = await repo.findById(scope, input.deliveryId);
    if (!delivery) throw new DeliveryNotFoundError(input.deliveryId);

    const assignments = (await repo.listAssignments(scope, delivery.id)).map(toAssignment);
    const state = input.buildState(delivery, assignments);
    const decision = nextOffer(state, input.now);

    switch (decision.kind) {
      case "IDLE":
        return { kind: "IDLE", reason: decision.reason };

      case "WAIT":
        return { kind: "WAITING", until: decision.until };

      case "EXPIRE": {
        for (const assignmentId of decision.assignmentIds) {
          await repo.updateAssignmentStatus(scope, {
            assignmentId,
            toStatus: "EXPIRED",
            respondedAt: input.now,
          });
        }
        return { kind: "EXPIRED", assignmentIds: decision.assignmentIds };
      }

      case "EXHAUSTED": {
        await repo.recordDispatchRound(scope, {
          deliveryId: delivery.id,
          roundNumber: decision.roundNumber,
          startedAt: input.now,
          decisions: decision.records.map((record) => ({
            driverId: record.driverId,
            decision: record.decision,
            reason: record.reason,
            rank: record.rank,
            distanceMeters: record.distanceMeters,
            estimatedPickupSeconds: record.estimatedPickupSeconds,
          })),
        });
        return { kind: "EXHAUSTED" };
      }

      case "OFFER": {
        await repo.createAssignments(
          scope,
          decision.offers.map((offer) => ({
            deliveryId: delivery.id,
            driverId: offer.driverId,
            rank: offer.rank,
            offeredAt: offer.offeredAt,
            expiresAt: offer.expiresAt,
          })),
        );

        await repo.recordDispatchRound(scope, {
          deliveryId: delivery.id,
          roundNumber: decision.roundNumber,
          startedAt: input.now,
          decisions: decision.records.map((record) => ({
            driverId: record.driverId,
            decision: record.decision,
            reason: record.reason,
            rank: record.rank,
            distanceMeters: record.distanceMeters,
            estimatedPickupSeconds: record.estimatedPickupSeconds,
          })),
        });

        // Le passage en OFFERING accompagne le premier tour ; les suivants
        // laissent le statut inchangé.
        if (delivery.status !== "OFFERING") {
          // La transition est validée comme n'importe quelle autre : le
          // dispatch n'a pas de passe-droit sur la machine d'état.
          assertDeliveryTransition(delivery.status, "OFFERING", "system");

          const opened = await repo.updateStatus(scope, {
            deliveryId: delivery.id,
            expectedVersion: delivery.version,
            toStatus: "OFFERING",
          });

          // Sans cette garde, un second worker créerait un jeu d'offres
          // concurrent et écrirait un événement que l'état ne reflète pas.
          if (!opened) {
            throw new DeliveryConflictError(
              "La livraison a été modifiée pendant le tour de dispatch. Recharger et réessayer.",
            );
          }

          await repo.appendStatusEvent(scope, {
            deliveryId: delivery.id,
            fromStatus: delivery.status,
            toStatus: "OFFERING",
            actorRole: "system",
            actorId: null,
            reason: "Ouverture d'un tour de dispatch.",
          });
        }

        return { kind: "OFFERS_CREATED", offered: decision.offers.map((o) => o.driverId) };
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Réponse d'un driver
// ---------------------------------------------------------------------------

export interface RespondInput {
  readonly assignmentId: string;
  readonly driverId: string;
  readonly response: "ACCEPTED" | "REJECTED";
  readonly rejectionReason?: string;
  readonly now: Date;
}

export type RespondOutcome =
  | { readonly kind: "ACCEPTED"; readonly deliveryId: string }
  | { readonly kind: "REJECTED"; readonly deliveryId: string }
  | { readonly kind: "REFUSED"; readonly code: string; readonly message: string };

/**
 * Enregistre la réponse d'un driver à une proposition.
 *
 * Deux drivers qui acceptent au même instant : le premier écrit, le second se
 * heurte au verrou optimiste sur `Delivery.version` et repart avec un refus
 * explicite. La vérification métier en amont évite le travail inutile ; c'est
 * la transaction qui garantit le résultat.
 */
export async function respondToAssignment(
  store: DeliveryTransactionalStore,
  scope: TenantScope,
  input: RespondInput,
): Promise<RespondOutcome> {
  return store.runInTransaction(async (repo) => {
    const target = await repo.findAssignmentById(scope, input.assignmentId);
    if (!target) {
      return { kind: "REFUSED", code: "NOT_FOUND", message: "Proposition introuvable." };
    }

    const delivery = await repo.findById(scope, target.deliveryId);
    if (!delivery) throw new DeliveryNotFoundError(target.deliveryId);

    const outcome = respondToOffer({
      assignment: toAssignment(target),
      respondingDriverId: input.driverId,
      response: input.response,
      // La propriété courante est portée par la livraison, jamais déduite de
      // l'historique des propositions : un ACCEPTED passé est un fait, pas un
      // verrou. C'est ce qui permet à un second driver de reprendre une course
      // rendue.
      currentOwnership: {
        status: delivery.status,
        assignedDriverId: delivery.assignedDriverId,
      },
      now: input.now,
    });

    if (!outcome.ok) {
      return { kind: "REFUSED", code: outcome.code, message: outcome.message };
    }

    if (outcome.status === "REJECTED") {
      await repo.updateAssignmentStatus(scope, {
        assignmentId: target.id,
        toStatus: "REJECTED",
        respondedAt: input.now,
        ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
      });
      return { kind: "REJECTED", deliveryId: delivery.id };
    }

    // La transition passe par la machine d'état, comme toutes les autres.
    // Sans cet appel, une livraison en PENDING_DISPATCH pouvait devenir
    // ASSIGNED — une transition qui n'existe pas dans la table.
    assertDeliveryTransition(delivery.status, "ASSIGNED", "driver");

    // Le verrou optimiste tranche les acceptations simultanées.
    const written = await repo.updateStatus(scope, {
      deliveryId: delivery.id,
      expectedVersion: delivery.version,
      toStatus: "ASSIGNED",
      assignedDriverId: input.driverId,
    });

    if (!written) {
      return {
        kind: "REFUSED",
        code: "DELIVERY_ALREADY_ASSIGNED",
        message: "Un autre driver a déjà accepté cette course.",
      };
    }

    await repo.updateAssignmentStatus(scope, {
      assignmentId: target.id,
      toStatus: "ACCEPTED",
      respondedAt: input.now,
    });

    await repo.appendStatusEvent(scope, {
      deliveryId: delivery.id,
      fromStatus: delivery.status,
      toStatus: "ASSIGNED",
      actorRole: "driver",
      actorId: input.driverId,
      reason: "Un driver a accepté la proposition.",
    });

    return { kind: "ACCEPTED", deliveryId: delivery.id };
  });
}

export type { DeliveryRepository, DeliverySnapshot };
