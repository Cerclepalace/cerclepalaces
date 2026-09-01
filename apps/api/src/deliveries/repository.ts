/**
 * Contrats de persistance de la livraison.
 *
 * **Chaque méthode tenantée prend le `TenantScope` en premier paramètre, sans
 * valeur par défaut et sans variante optionnelle.** Ce n'est pas une convention
 * documentaire : `TenantScope` est un type nominal (voir
 * `packages/domain/src/tenancy/scope.ts`), donc oublier le scope ou lui
 * substituer un `merchantId` nu ne compile pas.
 *
 * Les accès inter-tenant existent, mais portent un nom qui se voit en revue :
 * `findForAdmin`. Aucun rôle ne contourne implicitement le scope — un admin
 * doit appeler une méthode faite pour ça.
 *
 * Comme pour les commandes, le service dépend de ces interfaces et non de
 * Prisma : les règles se vérifient sans base de données.
 */

import type {
  AdminScope,
  AssignmentStatus,
  DeliveryStatus,
  DispatchReason,
  TenantScope,
} from "@cbd/domain";
import type { Actor } from "@cbd/domain";

export interface DeliverySnapshot {
  readonly id: string;
  readonly merchantId: string;
  readonly orderId: string;
  readonly status: DeliveryStatus;
  readonly assignedDriverId: string | null;
  readonly pickupZoneId: string | null;
  readonly dropoffZoneId: string | null;
  /** Verrou optimiste : deux acceptations simultanées ne peuvent pas passer. */
  readonly version: number;
}

export interface AssignmentRecord {
  readonly id: string;
  readonly deliveryId: string;
  readonly driverId: string;
  readonly status: AssignmentStatus;
  readonly rank: number;
  readonly offeredAt: Date;
  readonly expiresAt: Date;
}

export interface DeliveryStatusEventInput {
  readonly deliveryId: string;
  readonly fromStatus: DeliveryStatus;
  readonly toStatus: DeliveryStatus;
  readonly actorRole: Actor;
  readonly actorId: string | null;
  readonly reason: string;
}

export interface AuditEntryInput {
  readonly actorUserId: string | null;
  readonly actorRole: Actor;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: Record<string, unknown>;
}

export interface CreateAssignmentInput {
  readonly deliveryId: string;
  readonly driverId: string;
  readonly rank: number;
  readonly offeredAt: Date;
  readonly expiresAt: Date;
}

export interface DispatchDecisionInput {
  readonly driverId: string;
  readonly decision: "OFFERED" | "SKIPPED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  readonly reason: DispatchReason;
  readonly rank: number | null;
  readonly distanceMeters: number | null;
  readonly estimatedPickupSeconds: number | null;
}

export interface DeliveryRepository {
  /** Lecture scopée. Renvoie `null` pour une livraison d'un autre tenant. */
  findById(scope: TenantScope, deliveryId: string): Promise<DeliverySnapshot | null>;

  listByStatus(
    scope: TenantScope,
    status: DeliveryStatus,
  ): Promise<readonly DeliverySnapshot[]>;

  /**
   * Écrit le statut **si** la version en base est toujours celle lue.
   * Renvoie `false` sinon.
   */
  updateStatus(
    scope: TenantScope,
    input: {
      readonly deliveryId: string;
      readonly expectedVersion: number;
      readonly toStatus: DeliveryStatus;
      readonly assignedDriverId?: string | null;
    },
  ): Promise<boolean>;

  appendStatusEvent(scope: TenantScope, input: DeliveryStatusEventInput): Promise<void>;

  listAssignments(scope: TenantScope, deliveryId: string): Promise<readonly AssignmentRecord[]>;

  /**
   * Lecture d'une proposition par son identifiant, scopée.
   *
   * Une proposition n'a pas de `merchantId` propre : elle est atteinte via sa
   * livraison, qui en a un. L'implémentation doit donc joindre `Delivery` et
   * filtrer dessus — renvoyer `null` si la proposition relève d'un autre tenant.
   */
  findAssignmentById(
    scope: TenantScope,
    assignmentId: string,
  ): Promise<AssignmentRecord | null>;

  createAssignments(
    scope: TenantScope,
    inputs: readonly CreateAssignmentInput[],
  ): Promise<readonly AssignmentRecord[]>;

  /**
   * `respondedAt` n'est renseigné que lorsqu'un driver a réellement répondu.
   * Une clôture décidée par la plateforme (course annulée, driver libéré) n'est
   * pas une réponse : elle laisse l'horodatage existant intact plutôt que
   * d'inventer une réponse qui n'a pas eu lieu.
   */
  updateAssignmentStatus(
    scope: TenantScope,
    input: {
      readonly assignmentId: string;
      readonly toStatus: AssignmentStatus;
      readonly respondedAt?: Date;
      readonly rejectionReason?: string;
    },
  ): Promise<void>;

  recordDispatchRound(
    scope: TenantScope,
    input: {
      readonly deliveryId: string;
      readonly roundNumber: number;
      readonly startedAt: Date;
      readonly decisions: readonly DispatchDecisionInput[];
    },
  ): Promise<void>;

  appendAuditEntry(scope: TenantScope, input: AuditEntryInput): Promise<void>;

  /**
   * Accès inter-tenant, réservé au back-office plateforme.
   *
   * Nommée explicitement pour qu'un appel se remarque en revue de code. Elle
   * n'est pas une surcharge de `findById` : le typage empêche de l'atteindre
   * avec un `TenantScope`, et inversement.
   */
  findForAdmin(scope: AdminScope, deliveryId: string): Promise<DeliverySnapshot | null>;
}

export interface DeliveryTransactionalStore {
  runInTransaction<T>(work: (repo: DeliveryRepository) => Promise<T>): Promise<T>;
}

/**
 * Le driver n'est pas une ressource tenantée : il appartient au réseau, pas à un
 * shop. Ses méthodes ne prennent donc pas de `TenantScope` — et c'est documenté
 * ici plutôt que laissé à l'interprétation.
 *
 * Un driver ne peut pas pour autant s'en servir pour franchir une frontière de
 * tenant : l'accès à une livraison passe toujours par `DeliveryRepository`, qui
 * est scopé, et par le guard qui vérifie qu'il est bien le driver assigné.
 */
export interface DriverRepository {
  findById(driverId: string): Promise<DriverRecord | null>;
  findByUserId(userId: string): Promise<DriverRecord | null>;
  /** Candidats d'une zone, pour le moteur de dispatch. Non tenanté par nature. */
  listDispatchableInZone(zoneId: string): Promise<readonly DriverRecord[]>;
  setAvailability(input: {
    readonly driverId: string;
    readonly availability: DriverAvailabilityValue;
    readonly now: Date;
  }): Promise<void>;
}

export type DriverAvailabilityValue = "OFFLINE" | "ONLINE" | "PAUSED";

export interface DriverRecord {
  readonly id: string;
  readonly userId: string;
  readonly verification: "APPLICATION_SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED";
  readonly availability: DriverAvailabilityValue;
  readonly zoneIds: readonly string[];
  readonly position: { readonly lat: number; readonly lng: number } | null;
  readonly activeDeliveries: number;
  readonly supportedCategories: readonly string[];
}
