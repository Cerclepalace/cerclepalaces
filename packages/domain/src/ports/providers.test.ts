import { describe, expect, it } from "vitest";

import {
  DeliveryProviderNotConfiguredError,
  NoopDeliveryProvider,
} from "./delivery-provider.js";
import { NoopPaymentProvider, PaymentNotConfiguredError } from "./payment-provider.js";

// TEST 10 de la mission.
describe("NoopPaymentProvider", () => {
  const provider = new NoopPaymentProvider();

  it("refuse toute création d'intention de paiement", async () => {
    await expect(provider.createIntent()).rejects.toThrow(PaymentNotConfiguredError);
  });

  it("refuse tout encaissement", async () => {
    await expect(provider.capture()).rejects.toThrow(PaymentNotConfiguredError);
  });

  it("refuse tout remboursement", async () => {
    await expect(provider.refund()).rejects.toThrow(PaymentNotConfiguredError);
  });

  it("refuse toute annulation", async () => {
    await expect(provider.cancel()).rejects.toThrow(PaymentNotConfiguredError);
  });

  it("refuse de valider un webhook", async () => {
    await expect(provider.verifyWebhook()).rejects.toThrow(PaymentNotConfiguredError);
  });

  it("ne fait jamais semblant de réussir", async () => {
    // Un faux succès de paiement laisserait passer une commande en PAID sans
    // qu'aucun euro n'ait bougé : chaque opération doit rejeter, aucune ne doit
    // résoudre avec une valeur.
    const opérations = [
      provider.createIntent(),
      provider.capture(),
      provider.cancel(),
      provider.refund(),
      provider.verifyWebhook(),
    ];
    const résultats = await Promise.allSettled(opérations);
    expect(résultats.every((r) => r.status === "rejected")).toBe(true);
  });

  it("renvoie vers les décisions bloquantes", async () => {
    await expect(provider.createIntent()).rejects.toThrow(/TO_VERIFY/);
  });
});

// TEST 11 de la mission.
describe("NoopDeliveryProvider", () => {
  const provider = new NoopDeliveryProvider();

  it("ne produit aucun devis", async () => {
    await expect(provider.quote()).rejects.toThrow(DeliveryProviderNotConfiguredError);
  });

  it("ne crée aucune course réelle", async () => {
    await expect(provider.createDelivery()).rejects.toThrow(DeliveryProviderNotConfiguredError);
  });

  it("refuse annulation, consultation et webhook", async () => {
    await expect(provider.cancelDelivery()).rejects.toThrow(DeliveryProviderNotConfiguredError);
    await expect(provider.getDeliveryStatus()).rejects.toThrow(DeliveryProviderNotConfiguredError);
    await expect(provider.handleWebhook()).rejects.toThrow(DeliveryProviderNotConfiguredError);
  });

  it("ne fait jamais semblant d'avoir confié une course", async () => {
    const résultats = await Promise.allSettled([
      provider.quote(),
      provider.createDelivery(),
      provider.cancelDelivery(),
      provider.getDeliveryStatus(),
      provider.handleWebhook(),
    ]);
    expect(résultats.every((r) => r.status === "rejected")).toBe(true);
  });

  it("s'identifie comme noop, jamais comme un transporteur", () => {
    expect(provider.name).toBe("noop");
    expect(provider.name).not.toMatch(/uber|stuart|deliveroo/i);
  });
});
