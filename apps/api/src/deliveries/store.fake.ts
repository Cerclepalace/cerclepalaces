/**
 * Dépôt de livraison en mémoire, pour les tests.
 *
 * Il reproduit fidèlement quatre comportements, et chacun compte :
 *
 *   1. **le filtrage par tenant** — une lecture hors scope renvoie `null`,
 *      exactement comme un `where merchantId` en base ;
 *   2. **le verrou optimiste** — un compare-and-set sur `version`, évalué au
 *      moment de l'écriture contre l'état partagé, comme le ferait un
 *      `updateMany({ where: { id, version } })` ;
 *   3. **l'atomicité par transaction** — un échec annule **ses propres**
 *      écritures, jamais celles des transactions concurrentes ;
 *   4. **une fenêtre d'interleaving contrôlable** — le point d'arrêt entre la
 *      lecture et l'écriture, là où les races se produisent réellement.
 *
 * Un faux qui ignorerait le scope validerait un service qui fuit ; un faux qui
 * restaurerait un instantané global masquerait les vrais bugs de concurrence.
 */

import { assertBelongsToTenant, type AdminScope, type TenantScope } from "@cbd/domain";

import type { InterleavePoint } from "./concurrency.harness.js";
import type {
  AssignmentRecord,
  AuditEntryInput,
  CreateAssignmentInput,
  DeliveryRepository,
  DeliverySnapshot,
  DeliveryStatusEventInput,
  DeliveryTransactionalStore,
  DispatchDecisionInput,
} from "./repository.js";

export interface RecordedRound {
  readonly deliveryId: string;
  readonly roundNumber: number;
  readonly decisions: readonly DispatchDecisionInput[];
}

/** Annulation d'une écriture unique, rejouée à l'envers si la transaction échoue. */
type UndoEntry = () => void;

export class FakeDeliveryStore implements DeliveryTransactionalStore {
  private deliveries = new Map<string, DeliverySnapshot>();
  private assignments = new Map<string, AssignmentRecord>();
  statusEvents: DeliveryStatusEventInput[] = [];
  auditEntries: AuditEntryInput[] = [];
  rounds: RecordedRound[] = [];

  /** Simule une écriture concurrente entre la lecture et l'écriture. */
  onBeforeUpdate: ((deliveryId: string) => void) | undefined;

  /** Point d'arrêt contrôlé par le test, attendu avant chaque compare-and-set. */
  interleave: InterleavePoint | undefined;

  private nextAssignmentId = 1;

  constructor(
    deliveries: readonly DeliverySnapshot[] = [],
    assignments: readonly AssignmentRecord[] = [],
  ) {
    for (const delivery of deliveries) this.deliveries.set(delivery.id, delivery);
    for (const assignment of assignments) this.assignments.set(assignment.id, assignment);

    // Les identifiants générés ne doivent jamais entrer en collision avec ceux
    // fournis au départ : une collision écraserait l'historique des
    // propositions, précisément ce que ce modèle doit préserver.
    this.nextAssignmentId = assignments.length + 1;
    while (this.assignments.has(`asg_${this.nextAssignmentId}`)) this.nextAssignmentId += 1;
  }

  get(deliveryId: string): DeliverySnapshot | undefined {
    return this.deliveries.get(deliveryId);
  }

  getAssignment(assignmentId: string): AssignmentRecord | undefined {
    return this.assignments.get(assignmentId);
  }

  allAssignments(): readonly AssignmentRecord[] {
    return [...this.assignments.values()];
  }

  /**
   * Insère une proposition en cours de scénario, hors transaction.
   *
   * Réservé aux tests qui doivent poser un état intermédiaire que le service ne
   * produit pas lui-même — un second tour de dispatch simulé, par exemple.
   */
  addAssignment(assignment: AssignmentRecord): AssignmentRecord {
    this.assignments.set(assignment.id, assignment);
    while (this.assignments.has(`asg_${this.nextAssignmentId}`)) this.nextAssignmentId += 1;
    return assignment;
  }

  bumpVersion(deliveryId: string): void {
    const delivery = this.deliveries.get(deliveryId);
    if (delivery) this.deliveries.set(deliveryId, { ...delivery, version: delivery.version + 1 });
  }

  /** Événements d'une livraison, dans l'ordre d'écriture. */
  eventsFor(deliveryId: string): readonly DeliveryStatusEventInput[] {
    return this.statusEvents.filter((event) => event.deliveryId === deliveryId);
  }

  async runInTransaction<T>(work: (repo: DeliveryRepository) => Promise<T>): Promise<T> {
    const undo: UndoEntry[] = [];
    try {
      return await work(this.repository(undo));
    } catch (error) {
      // Annulation ciblée : on défait ses propres écritures, dans l'ordre
      // inverse, sans toucher à celles des transactions concurrentes.
      for (let i = undo.length - 1; i >= 0; i -= 1) undo[i]?.();
      throw error;
    }
  }

  /** Équivalent d'un `where merchantId` : hors scope, la ressource n'existe pas. */
  private scoped(scope: TenantScope, deliveryId: string): DeliverySnapshot | null {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) return null;
    if (delivery.merchantId !== scope.merchantId) return null;
    return delivery;
  }

  private repository(undo: UndoEntry[]): DeliveryRepository {
    return {
      findById: async (scope, deliveryId) => this.scoped(scope, deliveryId),

      listByStatus: async (scope, status) =>
        [...this.deliveries.values()].filter(
          (delivery) => delivery.merchantId === scope.merchantId && delivery.status === status,
        ),

      updateStatus: async (scope, { deliveryId, expectedVersion, toStatus, assignedDriverId }) => {
        this.onBeforeUpdate?.(deliveryId);
        // Fenêtre de course : le test peut suspendre ici, après que d'autres
        // tâches ont lu le même état, avant que celle-ci n'écrive.
        if (this.interleave) await this.interleave.wait();

        // Compare-and-set contre l'état **partagé et courant**, pas contre une
        // valeur lue plus tôt : c'est ce que fait un updateMany conditionnel.
        const delivery = this.scoped(scope, deliveryId);
        if (!delivery) return false;
        if (delivery.version !== expectedVersion) return false;

        const previous = delivery;
        this.deliveries.set(deliveryId, {
          ...delivery,
          status: toStatus,
          version: delivery.version + 1,
          ...(assignedDriverId !== undefined ? { assignedDriverId } : {}),
        });
        undo.push(() => this.deliveries.set(deliveryId, previous));
        return true;
      },

      appendStatusEvent: async (scope, input) => {
        const delivery = this.scoped(scope, input.deliveryId);
        if (!delivery) throw new Error("Écriture d'historique hors scope tenant.");
        this.statusEvents.push(input);
        undo.push(() => {
          const index = this.statusEvents.lastIndexOf(input);
          if (index >= 0) this.statusEvents.splice(index, 1);
        });
      },

      listAssignments: async (scope, deliveryId) => {
        const delivery = this.scoped(scope, deliveryId);
        if (!delivery) return [];
        return [...this.assignments.values()].filter((a) => a.deliveryId === deliveryId);
      },

      findAssignmentById: async (scope, assignmentId) => {
        const assignment = this.assignments.get(assignmentId);
        if (!assignment) return null;
        // La proposition n'a pas de merchantId : on remonte à sa livraison.
        return this.scoped(scope, assignment.deliveryId) ? assignment : null;
      },

      createAssignments: async (scope, inputs) => {
        const created: AssignmentRecord[] = [];
        for (const input of inputs) {
          const delivery = this.scoped(scope, input.deliveryId);
          if (!delivery) throw new Error("Création de proposition hors scope tenant.");

          const record: AssignmentRecord = {
            id: `asg_${this.nextAssignmentId++}`,
            deliveryId: input.deliveryId,
            driverId: input.driverId,
            status: "OFFERED",
            rank: input.rank,
            offeredAt: input.offeredAt,
            expiresAt: input.expiresAt,
          };
          this.assignments.set(record.id, record);
          undo.push(() => this.assignments.delete(record.id));
          created.push(record);
        }
        return created;
      },

      updateAssignmentStatus: async (scope, { assignmentId, toStatus }) => {
        const assignment = this.assignments.get(assignmentId);
        if (!assignment) throw new Error("Proposition introuvable.");
        if (!this.scoped(scope, assignment.deliveryId)) {
          throw new Error("Mise à jour de proposition hors scope tenant.");
        }

        // Le faux reproduit l'index partiel `uniq_delivery_accepted_assignment`
        // de PostgreSQL. Sans cette garde, une suite en mémoire resterait verte
        // là où la vraie base rejette l'écriture — c'est exactement la
        // divergence relevée en intégration.
        if (toStatus === "ACCEPTED") {
          for (const autre of this.assignments.values()) {
            if (autre.id === assignmentId) continue;
            if (autre.deliveryId !== assignment.deliveryId) continue;
            if (autre.status !== "ACCEPTED") continue;
            throw new Error(
              'duplicate key value violates unique constraint "uniq_delivery_accepted_assignment"',
            );
          }
        }

        const previous = assignment;
        this.assignments.set(assignmentId, { ...assignment, status: toStatus });
        undo.push(() => this.assignments.set(assignmentId, previous));
      },

      recordDispatchRound: async (scope, input) => {
        const delivery = this.scoped(scope, input.deliveryId);
        if (!delivery) throw new Error("Journal de dispatch hors scope tenant.");
        const round: RecordedRound = {
          deliveryId: input.deliveryId,
          roundNumber: input.roundNumber,
          decisions: input.decisions,
        };
        this.rounds.push(round);
        undo.push(() => {
          const index = this.rounds.lastIndexOf(round);
          if (index >= 0) this.rounds.splice(index, 1);
        });
      },

      appendAuditEntry: async (scope, input) => {
        if (input.targetType === "Delivery") {
          const delivery = this.deliveries.get(input.targetId);
          if (delivery) assertBelongsToTenant(scope, delivery);
        }
        this.auditEntries.push(input);
        undo.push(() => {
          const index = this.auditEntries.lastIndexOf(input);
          if (index >= 0) this.auditEntries.splice(index, 1);
        });
      },

      // Accès inter-tenant explicite : pas de filtrage par merchant, mais une
      // méthode qu'on ne peut pas appeler par accident avec un TenantScope.
      findForAdmin: async (_scope: AdminScope, deliveryId) =>
        this.deliveries.get(deliveryId) ?? null,
    };
  }
}

export function aDelivery(overrides: Partial<DeliverySnapshot> = {}): DeliverySnapshot {
  return {
    id: "dlv_1",
    merchantId: "mer_a",
    orderId: "ord_1",
    status: "PENDING_DISPATCH",
    assignedDriverId: null,
    pickupZoneId: "paris-centre",
    dropoffZoneId: "paris-centre",
    version: 1,
    ...overrides,
  };
}

export function anAssignment(overrides: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return {
    id: "asg_1",
    deliveryId: "dlv_1",
    driverId: "drv_1",
    status: "OFFERED",
    rank: 1,
    offeredAt: new Date("2026-06-01T18:00:00Z"),
    expiresAt: new Date("2026-06-01T18:00:30Z"),
    ...overrides,
  };
}

export type { CreateAssignmentInput };
