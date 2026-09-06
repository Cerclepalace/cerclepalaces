/**
 * Service de commande — le seul écrivain d'un statut.
 *
 * Toute transition passe par ici, et une transition acceptée produit
 * **indissociablement** trois écritures, dans la même transaction :
 *
 *   1. le nouveau statut de la commande ;
 *   2. une ligne dans `OrderStatusEvent` (l'historique, qui fait preuve) ;
 *   3. une ligne dans `AuditLog` quand l'action est sensible.
 *
 * Si l'une échoue, aucune ne s'applique. C'est ce qui garantit qu'une commande
 * ne peut pas changer d'état sans laisser de trace — la trace n'est pas un
 * effet de bord qu'on pourrait oublier d'écrire, elle fait partie de l'écriture.
 *
 * Le service dépend d'une interface de dépôt, pas de Prisma : les règles se
 * testent sans base de données, et une erreur de règle se voit en millisecondes
 * plutôt qu'en intégration.
 */

import {
  assertTransition,
  isTerminalOrderStatus,
  requiresRefundDecision,
  type Actor,
  type AdminScope,
  type OrderFulfillmentMode,
  type OrderStatus,
  type TenantScope,
} from "@cbd/domain";

export interface OrderSnapshot {
  readonly id: string;
  readonly merchantId: string;
  readonly status: OrderStatus;
  /**
   * Quelle machine à états s'applique à cette commande.
   *
   * Lu depuis la commande, jamais fourni par l'appelant : c'est une propriété du
   * flux qu'elle suit, pas une option de la requête. Laisser une requête le
   * choisir permettrait de contourner la confirmation attendue en le déclarant
   * autrement.
   */
  readonly fulfillmentMode: OrderFulfillmentMode;
  readonly customerId: string;
  readonly locationId: string;
  readonly assignedDriverId?: string;
  /** Incrémenté à chaque transition : sert de garde contre les écritures concurrentes. */
  readonly version: number;
}

export interface StatusEventInput {
  readonly orderId: string;
  readonly fromStatus: OrderStatus;
  readonly toStatus: OrderStatus;
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

/**
 * Ce que le service attend de la couche de persistance. `runInTransaction`
 * expose un dépôt dont toutes les écritures partagent la même transaction.
 *
 * Comme pour la livraison, **chaque méthode prend le `TenantScope` en premier
 * paramètre**, sans valeur par défaut et sans variante optionnelle. Une commande
 * appartient à un merchant : la lire ou l'écrire sans dire lequel n'a pas de
 * sens, et le typage l'interdit.
 */
export interface OrderRepository {
  /** Lecture scopée. Renvoie `null` pour une commande d'un autre tenant. */
  findById(scope: TenantScope, orderId: string): Promise<OrderSnapshot | null>;
  /**
   * Écrit le nouveau statut **si** la version en base est toujours celle lue.
   * Renvoie `false` si une autre écriture est passée entre-temps.
   */
  updateStatus(
    scope: TenantScope,
    input: {
      readonly orderId: string;
      readonly expectedVersion: number;
      readonly toStatus: OrderStatus;
    },
  ): Promise<boolean>;
  appendStatusEvent(scope: TenantScope, input: StatusEventInput): Promise<void>;
  appendAuditEntry(scope: TenantScope, input: AuditEntryInput): Promise<void>;

  /**
   * Accès inter-tenant, réservé au back-office plateforme. Nommée explicitement
   * pour qu'un appel se remarque en revue de code.
   */
  findForAdmin(scope: AdminScope, orderId: string): Promise<OrderSnapshot | null>;
}

export interface TransactionalStore {
  runInTransaction<T>(work: (repo: OrderRepository) => Promise<T>): Promise<T>;
}

export class OrderNotFoundError extends Error {
  readonly status = 404;
  constructor(orderId: string) {
    // Message identique qu'il s'agisse d'une commande inexistante ou d'une
    // commande d'un autre tenant : distinguer les deux permettrait d'énumérer
    // les commandes des concurrents.
    super(`Commande ${orderId} introuvable.`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "OrderConflictError";
  }
}

/**
 * Actions dont la trace d'audit est obligatoire : elles engagent de l'argent ou
 * ferment une commande.
 */
const AUDITED_TARGETS: readonly OrderStatus[] = [
  "CANCELLED",
  "MERCHANT_REJECTED",
  "DELIVERY_FAILED",
  "INCIDENT",
  "DELIVERED",
];

export interface TransitionResult {
  readonly orderId: string;
  readonly fromStatus: OrderStatus;
  readonly toStatus: OrderStatus;
  /** Vrai si la sortie du chemin nominal après encaissement ouvre un remboursement. */
  readonly refundDecisionRequired: boolean;
}

export interface TransitionCommand {
  readonly orderId: string;
  readonly toStatus: OrderStatus;
  readonly actor: Actor;
  /** `null` pour l'acteur `system`, qui n'est pas un utilisateur. */
  readonly actorUserId: string | null;
}

/**
 * Applique une transition de statut.
 *
 * `assertTransition` valide la transition **et** le droit de l'acteur. Le
 * contrôle d'appartenance de la ressource (est-ce bien *sa* commande ?) est
 * fait en amont par `assertAuthorized` : les deux sont nécessaires et ne se
 * remplacent pas.
 */
export async function transitionOrder(
  store: TransactionalStore,
  scope: TenantScope,
  command: TransitionCommand,
): Promise<TransitionResult> {
  // `system` est réservé aux déclencheurs internes — webhook de paiement,
  // dispatch, expiration d'un délai. Aucune requête entrante ne peut s'en
  // réclamer, et le vérifier ici évite qu'un handler l'oublie.
  if (command.actor === "system" && command.actorUserId !== null) {
    throw new OrderConflictError("L'acteur système ne peut pas porter d'utilisateur.");
  }

  return store.runInTransaction(async (repo) => {
    const order = await repo.findById(scope, command.orderId);
    if (!order) throw new OrderNotFoundError(command.orderId);

    if (isTerminalOrderStatus(order.status)) {
      throw new OrderConflictError(
        `La commande est en état terminal (${order.status}) : plus aucune transition n'est possible.`,
      );
    }

    // Rejouer la même transition ne doit pas produire un second événement
    // d'historique — un webhook de PSP est livré plusieurs fois par conception.
    if (order.status === command.toStatus) {
      return {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: order.status,
        refundDecisionRequired: false,
      };
    }

    const transition = assertTransition(
      order.status,
      command.toStatus,
      command.actor,
      order.fulfillmentMode,
    );

    const written = await repo.updateStatus(scope, {
      orderId: order.id,
      expectedVersion: order.version,
      toStatus: command.toStatus,
    });

    // Deux requêtes concurrentes ont lu le même état ; la seconde doit échouer
    // plutôt qu'écraser la première. Sans cette garde, un shop et un admin
    // agissant en même temps produisent un historique incohérent.
    if (!written) {
      throw new OrderConflictError(
        "La commande a été modifiée entre-temps. Recharger et réessayer.",
      );
    }

    await repo.appendStatusEvent(scope, {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: command.toStatus,
      actorRole: command.actor,
      actorId: command.actorUserId,
      reason: transition.reason,
    });

    const refundDecisionRequired = requiresRefundDecision(
      order.status,
      command.toStatus,
      order.fulfillmentMode,
    );

    if (AUDITED_TARGETS.includes(command.toStatus) || refundDecisionRequired) {
      await repo.appendAuditEntry(scope, {
        actorUserId: command.actorUserId,
        actorRole: command.actor,
        action: `order.transition.${command.toStatus.toLowerCase()}`,
        targetType: "Order",
        targetId: order.id,
        metadata: {
          fromStatus: order.status,
          toStatus: command.toStatus,
          refundDecisionRequired,
        },
      });
    }

    return {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: command.toStatus,
      refundDecisionRequired,
    };
  });
}
