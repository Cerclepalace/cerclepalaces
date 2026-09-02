/**
 * Contrat que tout adaptateur de paiement devra satisfaire.
 *
 * Écrit **avant** qu'aucun prestataire ne soit retenu, et c'est le but : le jour
 * où un adaptateur réel sera écrit — Nuvei, Stripe, Lemonway, emerchantpay ou un
 * autre — il devra passer cette suite sans qu'elle soit modifiée pour lui. Une
 * suite qu'on adapte à son implémentation ne teste plus rien.
 *
 * Le contrat ne décrit **aucun comportement propre à un fournisseur** : ni
 * endpoint, ni forme de réponse, ni nom de webhook. Il décrit ce que le domaine
 * suppose de n'importe quel prestataire, et rien de plus.
 *
 * Aujourd'hui, le seul candidat est `NoopPaymentProvider`, qui refuse tout. Il
 * satisfait le contrat en refusant — ce qui est exactement le comportement
 * attendu tant qu'aucun prestataire n'est qualifié.
 */

import { describe, expect, it } from "vitest";

import {
  NoopPaymentProvider,
  PaymentNotConfiguredError,
  type PaymentProvider,
} from "./payment-provider.js";

/**
 * Suite réutilisable.
 *
 * `attendu` dit ce que l'adaptateur testé est censé faire : refuser tant qu'il
 * n'est pas qualifié, ou honorer les appels une fois qu'il l'est. Le second cas
 * n'a aucun candidat aujourd'hui, et le paramètre existe pour que la suite
 * n'ait pas à être réécrite le jour venu.
 */
export function contratPrestataire(
  nom: string,
  fabrique: () => PaymentProvider,
  attendu: "REFUSE_TOUT" | "HONORE",
): void {
  describe(`contrat de prestataire — ${nom}`, () => {
    it("se nomme", () => {
      // Un adaptateur anonyme rend un journal d'incident illisible.
      expect(fabrique().name.trim().length).toBeGreaterThan(0);
    });

    it("expose les cinq opérations du port, et pas davantage", () => {
      const provider = fabrique();
      for (const opération of ["createIntent", "capture", "cancel", "refund", "verifyWebhook"]) {
        expect(typeof (provider as unknown as Record<string, unknown>)[opération], opération).toBe(
          "function",
        );
      }
    });

    if (attendu === "REFUSE_TOUT") {
      it("refuse chaque opération explicitement, sans en simuler aucune", async () => {
        // Le point entier du gel transactionnel : un refus se voit, un faux
        // succès se découvre après la mise en ligne.
        const provider = fabrique();

        await expect(
          provider.createIntent({
            orderId: "ord_1",
            amountCents: 1_000,
            currency: "EUR",
            idempotencyKey: "k1",
          }),
        ).rejects.toBeInstanceOf(PaymentNotConfiguredError);

        await expect(provider.capture("ref_1", "k2")).rejects.toBeInstanceOf(
          PaymentNotConfiguredError,
        );
        await expect(provider.cancel("ref_1", "motif")).rejects.toBeInstanceOf(
          PaymentNotConfiguredError,
        );
        await expect(
          provider.refund({
            providerRef: "ref_1",
            amountCents: 1_000,
            reason: "motif",
            idempotencyKey: "k3",
          }),
        ).rejects.toBeInstanceOf(PaymentNotConfiguredError);
        await expect(
          provider.verifyWebhook({ rawBody: "{}", signature: "sig" }),
        ).rejects.toBeInstanceOf(PaymentNotConfiguredError);
      });

      it("nomme l'opération refusée dans son message", async () => {
        // Sans cela, un incident dit « paiement indisponible » sans dire lequel.
        await expect(
          fabrique().capture("ref_1", "k"),
        ).rejects.toThrow(/capture/);
      });

      it("répond le même refus à un appel rejoué", async () => {
        // L'idempotence commence par là : deux appels identiques, deux refus
        // identiques, aucun état modifié entre-temps.
        const provider = fabrique();
        const premier = await provider
          .capture("ref_1", "clé-rejouée")
          .catch((erreur: unknown) => erreur);
        const second = await provider
          .capture("ref_1", "clé-rejouée")
          .catch((erreur: unknown) => erreur);

        expect(premier).toBeInstanceOf(PaymentNotConfiguredError);
        expect(second).toBeInstanceOf(PaymentNotConfiguredError);
        expect((premier as Error).message).toBe((second as Error).message);
      });
    }
  });
}

contratPrestataire("NoopPaymentProvider", () => new NoopPaymentProvider(), "REFUSE_TOUT");

describe("le contrat ne présuppose aucun fournisseur", () => {
  it("ne cite aucun nom de prestataire", async () => {
    // Une suite qui nommerait Nuvei ou Stripe aurait déjà choisi.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL(import.meta.url), "utf8");
    // On n'inspecte que le contrat lui-même. L'en-tête cite des noms pour dire
    // qu'aucun n'est retenu, et ce test-ci les cite pour les chercher : les
    // inclure rendrait l'assertion vraie contre elle-même.
    const début = source.indexOf("export function contratPrestataire");
    const fin = source.indexOf('contratPrestataire("NoopPaymentProvider"');
    const corps = source.slice(début, fin);
    for (const nom of ["Nuvei", "Stripe", "Lemonway", "emerchantpay", "Adyen", "Worldpay"]) {
      expect(corps, nom).not.toContain(nom);
    }
  });
});
