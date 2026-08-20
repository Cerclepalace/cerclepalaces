/**
 * Port prestataire de livraison.
 *
 * **Interface seule.** Aucun transporteur externe n'est branché — ni Uber
 * Direct, ni Stuart, ni aucun autre — et aucun appel réseau n'existe dans ce
 * package.
 *
 * Deux modes de livraison coexisteront à terme :
 *
 *   - **réseau propre** : notre moteur de dispatch et nos drivers ;
 *   - **prestataire externe** : la course est confiée à un tiers.
 *
 * Ce port décrit le second. Il existe dès maintenant pour une raison précise :
 * si l'on écrit le service de livraison en supposant que le dispatch interne
 * est le seul chemin possible, brancher un prestataire plus tard devient une
 * refonte. Avec le port, c'est une implémentation supplémentaire.
 *
 * En V1, `NoopDeliveryProvider` est la seule implémentation, et le réseau
 * propre est le seul chemin actif.
 */

export interface DeliveryQuoteRequest {
  readonly pickup: { readonly lat: number; readonly lng: number };
  readonly dropoff: { readonly lat: number; readonly lng: number };
  readonly packageCategory: string;
  readonly requestedAt: Date;
}

export interface DeliveryQuote {
  readonly providerRef: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly estimatedPickupSeconds: number;
  readonly estimatedDropoffSeconds: number;
  /** Au-delà, le devis n'engage plus le prestataire. */
  readonly expiresAt: Date;
}

export interface CreateDeliveryRequest {
  readonly quoteRef: string;
  readonly orderId: string;
  readonly idempotencyKey: string;
}

export type ExternalDeliveryStatus =
  | "PENDING"
  | "ASSIGNED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED";

export interface ExternalDelivery {
  readonly providerRef: string;
  readonly status: ExternalDeliveryStatus;
  readonly trackingUrl?: string;
}

export interface DeliveryWebhookEnvelope {
  readonly rawBody: string;
  readonly signature: string;
}

export interface DeliveryWebhookEvent {
  readonly type: string;
  readonly providerRef: string;
  readonly status: ExternalDeliveryStatus;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface DeliveryProvider {
  readonly name: string;
  quote(request: DeliveryQuoteRequest): Promise<DeliveryQuote>;
  createDelivery(request: CreateDeliveryRequest): Promise<ExternalDelivery>;
  cancelDelivery(providerRef: string, reason: string): Promise<void>;
  getDeliveryStatus(providerRef: string): Promise<ExternalDelivery>;
  handleWebhook(envelope: DeliveryWebhookEnvelope): Promise<DeliveryWebhookEvent>;
}

export class DeliveryProviderNotConfiguredError extends Error {
  readonly status = 501;
  constructor(operation: string) {
    super(
      `Aucun prestataire de livraison externe n'est configuré : « ${operation} » est ` +
        "indisponible. La V1 fonctionne sur le réseau de drivers propre ; brancher un " +
        "transporteur tiers suppose une validation fournisseur préalable.",
    );
    this.name = "DeliveryProviderNotConfiguredError";
  }
}

/**
 * Implémentation par défaut : **ne crée aucune course réelle**.
 *
 * Comme pour le paiement, le refus est explicite plutôt que simulé. Un faux
 * succès laisserait croire qu'une course a été confiée à un transporteur alors
 * que personne ne viendra chercher le colis.
 */
export class NoopDeliveryProvider implements DeliveryProvider {
  readonly name = "noop";

  async quote(): Promise<DeliveryQuote> {
    throw new DeliveryProviderNotConfiguredError("quote");
  }

  async createDelivery(): Promise<ExternalDelivery> {
    throw new DeliveryProviderNotConfiguredError("createDelivery");
  }

  async cancelDelivery(): Promise<void> {
    throw new DeliveryProviderNotConfiguredError("cancelDelivery");
  }

  async getDeliveryStatus(): Promise<ExternalDelivery> {
    throw new DeliveryProviderNotConfiguredError("getDeliveryStatus");
  }

  async handleWebhook(): Promise<DeliveryWebhookEvent> {
    throw new DeliveryProviderNotConfiguredError("handleWebhook");
  }
}
