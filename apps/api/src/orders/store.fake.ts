/**
 * Dépôt en mémoire, pour les tests.
 *
 * Reproduit fidèlement les deux comportements qui comptent : le verrou
 * optimiste sur `version`, et l'atomicité — si le travail lève, rien n'est
 * conservé. Un faux qui « réussit toujours » validerait un service qui casse en
 * production.
 */

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
  onBeforeUpdate?: (orderId: string) => void;

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

  private repository(): OrderRepository {
    return {
      findById: async (orderId) => this.orders.get(orderId) ?? null,

      updateStatus: async ({ orderId, expectedVersion, toStatus }) => {
        this.onBeforeUpdate?.(orderId);

        const order = this.orders.get(orderId);
        if (!order) return false;
        if (order.version !== expectedVersion) return false;

        this.orders.set(orderId, { ...order, status: toStatus, version: order.version + 1 });
        return true;
      },

      appendStatusEvent: async (input) => {
        this.statusEvents.push(input);
      },

      appendAuditEntry: async (input) => {
        this.auditEntries.push(input);
      },
    };
  }
}

export function anOrder(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    id: "ord_1",
    status: "PAID",
    customerId: "usr_client",
    locationId: "loc_1",
    version: 1,
    ...overrides,
  };
}
