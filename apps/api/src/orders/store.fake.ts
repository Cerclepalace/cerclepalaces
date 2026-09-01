/**
 * Dépôt en mémoire, pour les tests.
 *
 * Reproduit fidèlement les deux comportements qui comptent : le verrou
 * optimiste sur `version`, et l'atomicité — si le travail lève, rien n'est
 * conservé. Un faux qui « réussit toujours » validerait un service qui casse en
 * production.
 */

import { assertBelongsToTenant, type AdminScope, type TenantScope } from "@cbd/domain";

import type {
  AuditEntryInput,
  OrderRepository,
  OrderSnapshot,
  StatusEventInput,
  TransactionalStore,
} from "./service.js";

export class FakeOrderStore implements TransactionalStore {
  private orders = new Map<string, OrderSnapshot>();
  statusEvents: StatusEventInput[] = [];
  auditEntries: AuditEntryInput[] = [];

  /** Simule une écriture concurrente : incrémente la version avant l'update. */
  onBeforeUpdate: ((orderId: string) => void) | undefined;

  constructor(orders: readonly OrderSnapshot[] = []) {
    for (const order of orders) this.orders.set(order.id, order);
  }

  get(orderId: string): OrderSnapshot | undefined {
    return this.orders.get(orderId);
  }

  bumpVersion(orderId: string): void {
    const order = this.orders.get(orderId);
    if (order) this.orders.set(orderId, { ...order, version: order.version + 1 });
  }

  async runInTransaction<T>(work: (repo: OrderRepository) => Promise<T>): Promise<T> {
    const ordersBefore = new Map(this.orders);
    const eventsBefore = [...this.statusEvents];
    const auditBefore = [...this.auditEntries];

    try {
      return await work(this.repository());
    } catch (error) {
      this.orders = ordersBefore;
      this.statusEvents = eventsBefore;
      this.auditEntries = auditBefore;
      throw error;
    }
  }

  /** Équivalent d'un `where merchantId` : hors scope, la commande n'existe pas. */
  private scoped(scope: TenantScope, orderId: string): OrderSnapshot | null {
    const order = this.orders.get(orderId);
    if (!order) return null;
    if (order.merchantId !== scope.merchantId) return null;
    return order;
  }

  private repository(): OrderRepository {
    return {
      findById: async (scope, orderId) => this.scoped(scope, orderId),

      updateStatus: async (scope, { orderId, expectedVersion, toStatus }) => {
        this.onBeforeUpdate?.(orderId);

        const order = this.scoped(scope, orderId);
        if (!order) return false;
        if (order.version !== expectedVersion) return false;

        this.orders.set(orderId, { ...order, status: toStatus, version: order.version + 1 });
        return true;
      },

      appendStatusEvent: async (scope, input) => {
        if (!this.scoped(scope, input.orderId)) {
          throw new Error("Écriture d'historique hors scope tenant.");
        }
        this.statusEvents.push(input);
      },

      appendAuditEntry: async (scope, input) => {
        if (input.targetType === "Order") {
          const order = this.orders.get(input.targetId);
          if (order) assertBelongsToTenant(scope, order);
        }
        this.auditEntries.push(input);
      },

      findForAdmin: async (_scope: AdminScope, orderId) => this.orders.get(orderId) ?? null,
    };
  }
}

export function anOrder(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    id: "ord_1",
    merchantId: "mer_a",
    status: "PAID",
    // Le flux historique du service : la commande attend une confirmation
    // extérieure avant que le shop puisse agir. Les tests du flux direct le
    // surchargent explicitement.
    fulfillmentMode: "EXTERNAL_CONFIRMATION",
    customerId: "usr_client",
    locationId: "loc_1",
    version: 1,
    ...overrides,
  };
}
