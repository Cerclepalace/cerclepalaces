/**
 * Port prestataire de paiement.
 *
 * **Interface seule.** Aucun PSP n'est retenu, aucun encaissement réel n'est
 * implémenté, et rien ici ne présuppose une réponse aux décisions 05 (qui est
 * le vendeur légal) et 09 (choix du PSP) de docs/TO_VERIFY.md.
 *
 * Ce port existe pour que le reste du code puisse être écrit sans attendre ces
 * décisions — et pour que le jour où elles tombent, le branchement soit un
 * nouveau fichier plutôt qu'une réécriture.
 *
 * Ce qui n'est **délibérément pas** dans cette interface, et n'y entrera pas
 * sans décision explicite : split payment, comptes connectés, reversements
 * multi-parties. Les modéliser reviendrait à trancher la décision 05 en
 * silence, du côté du modèle marketplace.
 */

export interface PaymentIntentRequest {
  readonly orderId: string;
  readonly amountCents: number;
  readonly currency: string;
  /** Idempotence : rejouer la même clé ne doit jamais encaisser deux fois. */
  readonly idempotencyKey: string;
}

export interface PaymentIntent {
  readonly providerRef: string;
  readonly status: "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED";
  /** URL de redirection si le PSP en exige une. */
  readonly redirectUrl?: string;
}

export interface RefundRequest {
  readonly providerRef: string;
  readonly amountCents: number;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly providerRef: string;
  readonly refundedCents: number;
}

export interface WebhookEnvelope {
  readonly rawBody: string;
  readonly signature: string;
}

export interface WebhookEvent {
  readonly type: string;
  readonly providerRef: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PaymentProvider {
  readonly name: string;
  createIntent(request: PaymentIntentRequest): Promise<PaymentIntent>;
  capture(providerRef: string, idempotencyKey: string): Promise<PaymentIntent>;
  cancel(providerRef: string, reason: string): Promise<void>;
  refund(request: RefundRequest): Promise<RefundResult>;
  /** Doit rejeter toute charge dont la signature ne vérifie pas. */
  verifyWebhook(envelope: WebhookEnvelope): Promise<WebhookEvent>;
}

export class PaymentNotConfiguredError extends Error {
  readonly status = 501;
  constructor(operation: string) {
    super(
      `Aucun prestataire de paiement n'est configuré : « ${operation} » est indisponible. ` +
        "Les décisions 05 (qui est le vendeur légal) et 09 (choix du PSP) doivent être " +
        "tranchées avant tout encaissement — voir docs/TO_VERIFY.md.",
    );
    this.name = "PaymentNotConfiguredError";
  }
}

/**
 * Implémentation par défaut : **refuse tout**.
 *
 * Elle n'est pas un bouchon de test qui ferait semblant de réussir. Un faux
 * succès de paiement serait la pire chose à laisser traîner dans une base de
 * code : une commande passerait en `PAID` sans qu'aucun euro n'ait bougé.
 *
 * Le refus est donc explicite, bruyant et typé.
 */
export class NoopPaymentProvider implements PaymentProvider {
  readonly name = "noop";

  async createIntent(): Promise<PaymentIntent> {
    throw new PaymentNotConfiguredError("createIntent");
  }

  async capture(): Promise<PaymentIntent> {
    throw new PaymentNotConfiguredError("capture");
  }

  async cancel(): Promise<void> {
    throw new PaymentNotConfiguredError("cancel");
  }

  async refund(): Promise<RefundResult> {
    throw new PaymentNotConfiguredError("refund");
  }

  async verifyWebhook(): Promise<WebhookEvent> {
    throw new PaymentNotConfiguredError("verifyWebhook");
  }
}
