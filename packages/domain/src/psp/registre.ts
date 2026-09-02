/**
 * Les dossiers réels, au 2 septembre 2026.
 *
 * **Données du projet, pas règles métier.** Ce fichier transcrit l'état du
 * dossier PSP tel qu'il est, et rien d'autre. Il est ici plutôt que dans un
 * tableau Markdown pour une raison : un tableau tenu à la main dérive, un
 * fichier typé confronté à des tests ne peut pas prétendre qu'un dossier est
 * qualifié alors qu'il ne l'est pas.
 *
 * **Règle de saisie, sans exception.** Une case ne reçoit une valeur que si une
 * preuve la porte. Aucune case n'est remplie par déduction, par cohérence
 * apparente ou par ce qu'un prestataire « accepte sûrement ». Ce qui n'est pas
 * établi n'est pas écrit : l'absence de réponse *est* l'information.
 *
 * Voir `docs/PSP-REGISTRE.md` pour le détail des preuves et des actions.
 */

import type { ProviderDossier } from "./dossier.js";
import { emptyDossier } from "./dossier.js";

/**
 * Nuvei — refus écrit sur le dossier soumis.
 *
 * Un seul point est renseigné, et c'est délibéré : l'e-mail refuse l'activité,
 * il ne dit rien de l'acquéreur, du code d'activité, des réseaux ni des modèles.
 * Renseigner ces points par déduction — « s'ils refusent l'activité, tout le
 * reste est refusé » — serait exactement l'erreur que ce registre existe pour
 * empêcher. Un refus d'activité n'est pas un refus d'acquéreur.
 *
 * La référence est `null` : l'e-mail existe, son identifiant d'archive n'a pas
 * été consigné. Cela ne change rien au verdict — un refus bloque qu'il soit
 * archivé ou non — mais `unarchivedResponses` ne le signalera pas non plus,
 * puisque cette fonction ne surveille que les acceptations. Le suivi de
 * l'archivage se fait dans le registre documentaire.
 */
export const NUVEI: ProviderDossier = {
  providerName: "Nuvei",
  qualification: {
    providerName: "Nuvei",
    responses: [
      {
        point: "ACTIVITY_ACCEPTED",
        answer: "NO",
        source: "WRITTEN_EMAIL",
        answeredAt: new Date("2026-08-26T00:00:00Z"),
        reference: null,
        conditions: null,
      },
    ],
  },
  capabilities: [
    { capability: "MULTI_VENDOR_MARKETPLACE", documentedIn: "dossier commercial Nuvei" },
    { capability: "SELLER_ONBOARDING_KYC", documentedIn: "dossier commercial Nuvei" },
    { capability: "SPLIT_DISBURSEMENT", documentedIn: "dossier commercial Nuvei" },
    { capability: "SELLER_SETTLEMENT", documentedIn: "dossier commercial Nuvei" },
    { capability: "MULTI_PARTY_RETURNS", documentedIn: "dossier commercial Nuvei" },
    { capability: "DISPUTE_HANDLING", documentedIn: "dossier commercial Nuvei" },
    { capability: "RECONCILIATION", documentedIn: "dossier commercial Nuvei" },
    { capability: "MERCHANT_OF_RECORD_SERVICE", documentedIn: "dossier commercial Nuvei" },
  ],
  outreach: [
    {
      subject: "Pre-approval request — French multi-vendor CBD marketplace",
      state: "ANSWERED",
      threadReference: null,
      preparedAt: null,
      sentAt: null,
      proofOfSending: null,
      answeredAt: new Date("2026-08-26T00:00:00Z"),
      note: "Réponse : « Based on location and business we would not be able to assist this business with services. » Le motif mêle localisation et activité sans les distinguer.",
    },
  ],
};

/**
 * Stripe — non qualifié, pas refusé.
 *
 * **Aucune réponse n'est enregistrée**, et c'est le point important. Les deux
 * messages archivés établissent une mise en attente puis une clôture
 * administrative du fil. Ni l'une ni l'autre n'est une décision : les
 * transcrire en `NO` inventerait un refus qui n'existe pas, et en `YES` une
 * acceptation qui n'existe pas davantage. Les quatorze points restent donc
 * `UNKNOWN`, ce qui est leur état exact.
 *
 * La démarche de réouverture est enregistrée comme `PREPARED` : le message est
 * rédigé, il n'est pas parti. Tant que `sentAt` est vide, personne n'attend de
 * réponse.
 */
export const STRIPE: ProviderDossier = {
  providerName: "Stripe",
  qualification: { providerName: "Stripe", responses: [] },
  capabilities: [],
  outreach: [
    {
      subject: "Pre-approval request — French multi-vendor CBD marketplace",
      state: "CLOSED_WITHOUT_DECISION",
      threadReference: null,
      preparedAt: null,
      sentAt: null,
      proofOfSending: null,
      answeredAt: null,
      note: "Fil mis en attente, puis demande de support close par Stripe avec possibilité de réouverture en répondant à l'e-mail. Aucune décision Risk, Compliance ou Underwriting.",
    },
    {
      subject: "Re: Pre-approval request — French multi-vendor CBD marketplace",
      state: "PREPARED",
      threadReference: null,
      preparedAt: new Date("2026-09-02T00:00:00Z"),
      sentAt: null,
      proofOfSending: null,
      answeredAt: null,
      note: "Message de réouverture rédigé, voir docs/PSP-STRIPE-RELANCE.md. Non envoyé : l'envoi est une action manuelle.",
    },
  ],
};

/**
 * RoxPay et Stancer — refus écrits du 21 août 2026, archives non consignées.
 *
 * La date est désormais établie ; la référence d'archive ne l'est toujours pas.
 * Le verdict est le même dans les deux cas, mais la distinction compte le jour
 * où il faut produire la pièce.
 *
 * **Le motif est enregistré comme motif, pas comme fait.** Les deux refus
 * invoquent des restrictions de réseaux cartes, de banques acquéreuses et de
 * régulateurs, et précisent que la légalité de l'activité n'est pas en cause.
 * C'est ce que ces prestataires *disent* de leur chaîne d'acceptation ; ce n'est
 * ni une décision de Visa, ni une décision de Mastercard, ni une décision d'un
 * acquéreur nommé, ni une position d'un régulateur. Aucun de ces points n'est
 * renseigné dans la qualification : citer un tiers ne l'engage pas.
 */
const refusDu21Aout = (nom: string): ProviderDossier => ({
  providerName: nom,
  qualification: {
    providerName: nom,
    responses: [
      {
        point: "ACTIVITY_ACCEPTED",
        answer: "NO",
        source: "WRITTEN_EMAIL",
        answeredAt: new Date("2026-08-21T00:00:00Z"),
        reference: null,
        conditions: null,
      },
    ],
  },
  capabilities: [],
  outreach: [
    {
      subject: "Pre-approval request — French multi-vendor CBD marketplace",
      state: "ANSWERED",
      threadReference: null,
      preparedAt: null,
      sentAt: null,
      proofOfSending: null,
      answeredAt: new Date("2026-08-21T00:00:00Z"),
      note: "Refus écrit du 21/08/2026. Motif énoncé par le prestataire : restrictions de réseaux cartes, de banques acquéreuses et de régulateurs ; le refus ne met pas en cause la légalité de l'activité. Référence d'archive à consigner : émetteur et objet.",
    },
  ],
});

export const ROXPAY: ProviderDossier = refusDu21Aout("RoxPay");
export const STANCER: ProviderDossier = refusDu21Aout("Stancer");

/**
 * Les cinq dossiers sans aucune preuve.
 *
 * Aucune réponse, aucune capacité vérifiée, aucune démarche datée. Ils existent
 * dans le registre pour être comptés parmi les prestataires **non qualifiés**,
 * pas parmi les pistes prometteuses. Un dossier vide n'est pas un dossier en
 * cours.
 *
 * MangoPay figure ici bien qu'il soit écarté par choix de projet : un écart
 * stratégique n'est pas un refus, et le compter parmi les refus fausserait la
 * lecture du dossier.
 */
export const LEMONWAY: ProviderDossier = emptyDossier("Lemonway");
export const EMERCHANTPAY: ProviderDossier = emptyDossier("emerchantpay");
export const PAYKINGS: ProviderDossier = emptyDossier("PayKings");
export const BRIDGEPAY: ProviderDossier = emptyDossier("BridgePay");
export const MANGOPAY: ProviderDossier = emptyDossier("MangoPay");

/** Le registre complet, dans l'ordre du document. */
export const PROVIDER_DOSSIERS: readonly ProviderDossier[] = [
  NUVEI,
  ROXPAY,
  STANCER,
  STRIPE,
  LEMONWAY,
  EMERCHANTPAY,
  PAYKINGS,
  BRIDGEPAY,
  MANGOPAY,
];
