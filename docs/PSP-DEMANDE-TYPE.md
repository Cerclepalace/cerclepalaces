# Demande de pré-approbation — modèle réutilisable

> À envoyer à tout candidat. Conçu pour être transmis tel quel à une équipe
> Risk / Compliance / Underwriting, sans reformulation.

Le message Stripe existant (`PSP-STRIPE-RELANCE.md`) reste spécifique à son fil.
Celui-ci est **neutre vis-à-vis du fournisseur** : aucun nom de produit, aucune
fonctionnalité propriétaire, aucune hypothèse sur l'organisation interne du
destinataire.

## Pourquoi ce format

Les questions suivent l'ordre où le code nomme ses dix-sept points de
qualification, et la plupart n'en portent qu'un. Une réponse groupée — « oui,
nous acceptons ce type d'activité » — ne remplit qu'une case ; les seize autres
restent `UNKNOWN`, et le message est construit pour que cela se voie. La table
de correspondance en fin de document dit exactement quelle question remplit
quelle case, y compris les deux qui ne se rangent pas une pour une.

La première question est celle qui décide de tout, et elle est posée en
premier : **qui souscrit le risque ?** Un prestataire qui ne peut pas nommer son
acquéreur ne peut pas engager celui-ci.

## Avant l'envoi

Remplacer les champs entre crochets. Ne pas retirer de question, même si le
destinataire semble ne pas pouvoir y répondre : une question sans réponse est
une information, et elle se consigne comme `NO_ANSWER`.

---

**Subject:** Pre-approval request — French multi-vendor marketplace, hemp-derived product categories

Hello,

We are requesting a written eligibility assessment before any live payment activity. We are not requesting technical integration approval, sandbox access or a commercial proposal at this stage.

**Applicant.** A French company operating a multi-vendor marketplace. The marketplace onboards professional third-party sellers, performs seller KYB/KYC, collects customer payments, deducts a marketplace commission and arranges seller settlement to verified bank accounts. Card-not-present, France-based customers, EUR.

**Product categories under review.** The platform uses a closed taxonomy of ten categories; a product matching none of them cannot be listed. We are not asserting that all of these are acceptable — we are asking you to qualify each one:
- `FLOWER` — hemp flower;
- `RESIN` — hemp resin;
- `OIL_NON_FOOD` — oils positioned exclusively for topical, non-food use;
- `COSMETIC` — cosmetics;
- `FOOD` — foodstuffs and beverages;
- `SUPPLEMENT` — food supplements;
- `VAPE` — vaping products;
- `ACCESSORY` — accessories containing no active compound;
- `OTHER` — unclassified; never listed, awaits human classification;
- `PROHIBITED_DERIVATIVE` — excluded by design, structurally closed in the platform.

**Explicitly excluded from scope by project decision.** Semi-synthetic cannabinoid derivatives: HHC, HHC-O, HHCP, HHCPO, H4-CBD, H2-CBD, THCP and comparable compounds. We state this as our own commercial and compliance scope, not as a statement of law.

Could you please forward this to the team competent for restricted or high-risk activities, and provide written answers to the following? A separate answer per question would help us — a single global answer leaves the other points unresolved on our side.

**Acquiring**

1. Which legal entity would act as the acquirer and underwrite the card transactions for this business?
2. In which country is that acquiring entity established, and under which licence?
3. Which merchant category code would apply, and would it differ across the product categories listed above?

**Acceptance**

4. Is this activity — hemp-derived products, France, card-not-present — eligible with that acquirer? Please state eligible, ineligible, or subject to enhanced underwriting.
5. For each of the categories listed above, taken separately: eligible, ineligible, restricted, or subject to enhanced underwriting?
6. Can Visa card acceptance be provided for each eligible category?
7. Can Mastercard card acceptance be provided for each eligible category?

**Model**

8. Model A — each seller is the legal seller of record, the marketplace acts as an intermediary and collects a service commission. Is this model accepted?
9. Model B — the marketplace acts as merchant of record and resells. Is this model accepted?
10. Are professional third-party seller onboarding, seller KYB/KYC and seller settlement supported for the accepted model?

**Conditions**

11. What compliance conditions would apply — documentation, laboratory certificates, age verification, product monitoring, periodic review?
12. What reserve would apply: type, rate, duration, release conditions?
13. What are the chargeback thresholds, penalties and remediation conditions?
14. What are the refund and settlement rules, including timing, holds and conditions under which funds may be withheld?
15. What is required, in writing, before any live processing may begin?

16. On termination: what notice applies, and what becomes of pending transactions, refunds, chargebacks and remaining funds after the account is closed?

We understand that any final decision remains subject to full KYB, underwriting, contractual review, product documentation and ongoing monitoring. We are not asking for a commitment today — we are asking for a written position we can rely on.

Please tell us which documents you need to proceed.

Kind regards,

[Nom]
[Société]
France
[Email]
[Téléphone]

---

## Après l'envoi

Consigner immédiatement, dans `packages/domain/src/psp/registre.ts` :

```ts
{
  subject: "…",
  state: "SENT",
  threadReference: "…",   // identifiant du fil ou du ticket
  preparedAt: …,
  sentAt: …,              // sans elle, l'envoi n'est pas enregistré
  proofOfSending: "…",    // accusé, identifiant de message, capture
  answeredAt: null,
  note: null,
}
```

`isActuallySent()` exige **la date et la preuve**. Sans les deux, la démarche
reste `PREPARED` — ce qui est exact tant que rien ne permet de prouver l'envoi.

## Lecture d'une réponse

Quatorze des seize questions portent **un seul** point de qualification. Deux
font exception, et la table le dit plutôt que de le masquer : la question 10
n'en porte aucune, la question 14 en porte deux. Les questions 6 et 7 en
partageaient une troisième jusqu'au 2 septembre 2026, faute d'axe réseaux
cartes ; elles ont désormais chacune la leur — écart `C-1` de la revue de
cohérence, `PSP-REGISTRE.md`.

| Question | Point |
|---|---|
| 1 | `ACQUIRING_ENTITY_IDENTIFIED` |
| 2 | `ACQUIRING_COUNTRY_IDENTIFIED` |
| 3 | `MERCHANT_CATEGORY_CODE_CONFIRMED` |
| 4 | `ACTIVITY_ACCEPTED` |
| 5 | `PRODUCT_CATEGORIES_ACCEPTED` |
| 6 | `VISA_ACCEPTANCE_CONFIRMED` |
| 7 | `MASTERCARD_ACCEPTANCE_CONFIRMED` |
| 8 | `MODEL_A_ACCEPTED` |
| 9 | `MODEL_B_ACCEPTED` |
| 10 | contribue au modèle retenu |
| 11 | `COMPLIANCE_CONDITIONS_STATED` |
| 12 | `RESERVE_CONDITIONS_STATED` |
| 13 | `CHARGEBACK_RULES_STATED` |
| 14 | `REFUND_RULES_STATED` et `SETTLEMENT_RULES_STATED` |
| 15 | `PRODUCTION_CONDITIONS_STATED` |
| 16 | `TERMINATION_CONDITIONS_STATED` |

`PROVIDER_IDENTIFIED` ne se coche pas à la réception d'une réponse : il exige que
le prestataire soit nommément engagé, ce qu'établit un contrat ou une décision de
portail, pas un échange de messages.

Une réponse qui élude une question la laisse à `NO_ANSWER`. Une réponse
favorable sans référence retrouvable est enregistrée mais ne qualifie pas :
`assessQualification` la rend `NOT_TRACEABLE`.
