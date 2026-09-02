# Stripe — dossier de qualification

> **Interne, en tête de document.** Ce dossier est écrit pour être **transmis
> tel quel** à une équipe Risk / Compliance / Underwriting. Il ne contient
> aucune réponse de Stripe : Stripe n'a rendu **aucune décision**, et le seul
> fait établi à ce jour est la clôture administrative d'un fil de support, qui
> n'est pas un refus.
>
> Statut au 2 septembre 2026 — `PSP_STATUS = UNKNOWN`, tous axes `UNKNOWN`,
> démarche `PREPARED`. Rien n'a été envoyé depuis cet environnement.
>
> Ce document est le **dossier** ; `PSP-STRIPE-RELANCE.md` est le **message**
> qui l'accompagne dans le fil existant. Les deux disent la même chose : le
> message est court pour être lu, le dossier est complet pour être instruit.

---

# cbd-Shop — Payment eligibility assessment dossier

**Prepared for:** Stripe Risk / Compliance / Underwriting / Restricted Businesses
**Prepared by:** Noa Durand — project cbd-Shop, France
**Contact:** [Email] · [Telephone]
**Date of preparation:** 2 September 2026
**Existing thread:** *Pre-approval request — French multi-vendor CBD marketplace*

## 0. What we are asking for, and what we are not

We are **not** requesting technical integration support, sandbox access, or
documentation. We already know what the API can do; that is not the question.

We are requesting a **written eligibility assessment** of a specific business,
before any live payment activity, covering the acquiring entity, the merchant
category code, the card networks, the two possible legal models, and the exit
conditions.

We are aware that a favourable answer on one point says nothing about the
others. We would rather receive a partial written answer with the remaining
points explicitly marked unanswered than a general favourable statement that we
would be unable to rely on later.

## 1. The business

A French company operating a **multi-vendor marketplace** selling CBD and
hemp-derived consumer products in France.

- Sellers are **professional businesses**, not consumers. Each is onboarded
  through KYB, beneficial-owner identification and sanctions screening.
- Products are reviewed individually before they can be listed, against a closed
  product taxonomy, a certificate of analysis and a prohibited-substance
  screening.
- Delivery is operated through a courier network.
- The platform is currently **pre-transactional**: no payment provider is
  integrated, no funds are collected, no ledger, wallet or payout mechanism
  exists. Nothing will be built on the payment side until this assessment,
  together with legal and tax validation, is complete.

## 2. Two possible legal models — we are asking you to qualify both

We have deliberately **not** chosen between them. The choice depends in part on
your answer, and choosing first would mean building on an assumption.

### Model A — Marketplace / Intermediary

The third-party seller remains the **contractual seller** of the product to the
customer. cbd-Shop operates the marketplace and receives a platform fee.

Questions on Model A:

| # | Question |
|---|---|
| A1 | Does Stripe accept this structure for this activity? |
| A2 | Can CBD sellers be onboarded as connected accounts? |
| A3 | What Stripe account type or status applies to them? |
| A4 | What KYB / KYC is required of each seller? |
| A5 | Can payments be split between the seller and the platform? |
| A6 | Are payouts to sellers permitted? |
| A7 | Who is responsible for refunds? |
| A8 | Who is responsible for chargebacks? |
| A9 | Who bears a negative balance arising after a payout has been made? |
| A10 | Which acquiring entity is involved? |
| A11 | Which MCC applies? |
| A12 | Do the card networks accept this structure? |

### Model B — Merchant of Record

cbd-Shop becomes the **contractual seller** to the customer. Third-party
businesses become suppliers.

Questions on Model B:

| # | Question |
|---|---|
| B1 | Does Stripe accept this structure for this activity? |
| B2 | Is CBD acceptable under this model? |
| B3 | What underwriting is required? |
| B4 | How may suppliers be paid? |
| B5 | How do refunds operate? |
| B6 | How do chargebacks operate? |
| B7 | Who carries the economic liability? |
| B8 | Which acquiring entity is involved? |
| B9 | Which MCC applies? |
| B10 | What restrictions apply? |

A "yes" on one model is **not** read by us as a "yes" on the other. If only one
is acceptable, please say which, and why.

## 3. Product taxonomy — please qualify each category separately

The platform uses a **closed** taxonomy of ten categories. A product that
matches none of them cannot be listed.

We are **not** asserting that all of these are acceptable. We are asking you to
qualify each one.

| # | Category | What it covers | Your answer |
|---|---|---|---|
| 1 | `FLOWER` | CBD hemp flower | YES / NO / YES SUBJECT TO WRITTEN CONDITIONS |
| 2 | `RESIN` | CBD hemp resin | YES / NO / YES SUBJECT TO WRITTEN CONDITIONS |
| 3 | `OIL_NON_FOOD` | CBD oils positioned for topical, non-ingestible use | YES / NO / YES SUBJECT TO WRITTEN CONDITIONS |
| 4 | `COSMETIC` | CBD cosmetics | YES / NO / YES SUBJECT TO WRITTEN CONDITIONS |
| 5 | `FOOD` | Foodstuffs and beverages containing CBD | YES / NO / YES SUBJECT TO WRITTEN CONDITIONS |
| 6 | `SUPPLEMENT` | Food supplements containing CBD | YES / NO / YES SUBJECT TO WRITTEN CONDITIONS |
| 7 | `VAPE` | Vaping products containing CBD | YES / NO / YES SUBJECT TO WRITTEN CONDITIONS |
| 8 | `ACCESSORY` | Accessories containing no CBD | YES / NO / YES SUBJECT TO WRITTEN CONDITIONS |
| 9 | `OTHER` | Unclassified. Never listed; awaits human classification | YES / NO / YES SUBJECT TO WRITTEN CONDITIONS |
| 10 | `PROHIBITED_DERIVATIVE` | **Excluded by design.** See below | — excluded, no answer required |

`PROHIBITED_DERIVATIVE` is **structurally closed** in the platform: no policy,
no rule and no administrative action can open it. It exists as a category so
that a product falling into it is named and refused, rather than silently
classified elsewhere.

Where a category is acceptable only under conditions, please state the exact
conditions in writing rather than the word "conditions".

## 4. Derivatives excluded from scope

The following are excluded from the platform's scope **by project decision**:

HHC · HHC-O · HHCP · HHCPO · H4-CBD · H2-CBD · THCP

We state this as our own commercial and compliance scope. We are **not**
presenting it as a statement of French or EU law; the legal characterisation of
these substances is subject to separate legal validation on our side.

## 5. Compliance controls already designed

These controls are built into the platform and gate listing. They are described
so that underwriting can assess the actual control environment, not an
intention.

- Seller KYB / KYC
- Beneficial-owner checks
- Sanctions screening
- Product approval before listing
- Product category controls against the closed taxonomy above
- Certificate of analysis required per product
- Laboratory identity recorded
- Lot / batch identification recorded
- Certificate issue date recorded
- Certificate expiry date recorded and enforced
- THC and cannabinoid information recorded as declared and certified
- Prohibited-substance controls, including alternative spellings of the same
  substance
- A single listing gate: a product that fails any check cannot be listed, and
  all failing reasons are returned rather than the first one
- Suspension mechanism for sellers and for individual products
- Audit trail of compliance decisions, with the deciding party and date

## 6. THC threshold — stated precisely, because precision matters here

The project currently uses a technical working threshold in its test fixtures,
but this value is not presented as final legal evidence. The final legal
threshold remains subject to legal validation.

Concretely: no regulatory threshold is hard-coded anywhere in the platform.
Declared and certified levels are recorded as declared; the applicable limit is
a reviewable parameter that must be backed by a verified legal source before it
takes effect. We would rather tell you this than quote a figure we cannot yet
support with a primary legal source.

## 7. ACQUIRING QUALIFICATION — REQUIRED

This is the central question of the dossier. A payment gateway that can
technically process the transaction does not answer it.

> **Which acquiring entity would underwrite the card transaction risk for this
> activity, and has that entity approved CBD as well as the proposed
> marketplace / Merchant of Record model?**

| # | Question | Your answer |
|---|---|---|
| Q1 | Which acquiring entity would be used? | |
| Q2 | What is its legal name? | |
| Q3 | In which country is it established? | |
| Q4 | Has it reviewed CBD as an activity? | |
| Q5 | Has it reviewed the marketplace model? | |
| Q6 | Has it reviewed Model A? | |
| Q7 | Has it reviewed Model B? | |
| Q8 | Is the file APPROVED / REJECTED / IN_PROGRESS / UNKNOWN? | |
| Q9 | Which MCC would be used? | |
| Q10 | Is that MCC confirmed, or indicative? | |
| Q11 | Does Visa impose specific conditions? | |
| Q12 | Does Mastercard impose specific conditions? | |

We record the answers to Q1–Q10 and to Q11–Q12 in **separate fields**, because
a provider decision, an acquirer decision and a card-network condition are three
different things. We will not read an answer to one as an answer to another.

## 8. Card networks — two independent confirmations

| Field | Current value | What would change it |
|---|---|---|
| `VISA_ACCEPTANCE` | `UNKNOWN` | A written, dated, retrievable confirmation naming Visa acceptance for this activity, or the conditions applying to it |
| `MASTERCARD_ACCEPTANCE` | `UNKNOWN` | The same, for Mastercard |

A general statement that "this is supported by Stripe" will be recorded as a
statement about Stripe. It will not be recorded as Visa acceptance, and it will
not be recorded as Mastercard acceptance.

## 9. Refunds

Please state, for the applicable model:

- Full refund
- Partial refund
- Refund before payout
- Refund after payout
- Refund after seller suspension
- Refund after seller termination
- Insufficient seller balance
- Negative balance
- Treatment of fees
- Treatment of reserve

## 10. Chargebacks

Please state:

- Who is the merchant of record for card scheme purposes
- Who responds to the chargeback
- Who supplies the evidence
- Who bears the economic loss
- Seller liability
- Platform liability
- Treatment after payout
- Negative balance
- Reserve
- Suspension
- Termination

## 11. Reserves and risk controls

Please state:

- Rolling reserve
- Fixed reserve
- Initial reserve
- Percentage
- Duration
- Release conditions
- Increase triggers
- Payout delays
- Transaction limits
- Risk controls
- Negative balance mechanism

## 12. Suspension and termination

Please state:

- Compliance freeze
- Payment suspension
- Payout suspension
- Reserve increase
- Termination
- Notice period
- Treatment of pending transactions
- Treatment of refunds after termination
- Treatment of chargebacks after termination
- Treatment of remaining funds

## 13. Requested answer format

For each critical question, please answer:

**YES** · **NO** · **YES SUBJECT TO WRITTEN CONDITIONS**

— and, where conditions exist, the exact conditions.

We would ask you to note what we cannot treat as an answer, so that neither side
wastes a cycle on it:

- "potentially supported" — we will record this as no answer;
- a general commercial statement — we will record this as no answer;
- a link to technical documentation — documentation is not an approval;
- sandbox access — a working integration is not an authorisation.

An explicit "we cannot answer this point" is more useful to us than a
favourable general statement, and we will record it as such without treating it
as a refusal.

## 14. Documents we can provide on request

- Company registration and statutes
- Beneficial-owner information
- Seller onboarding procedure and KYB checklist
- Product approval procedure and listing-gate rules
- Sample certificate of analysis and the fields we require from a laboratory
- Product taxonomy definition
- Prohibited-substance screening rules
- Projected volumes and average basket, marked as projections
- Delivery model description

## 15. What this dossier does not claim

- It does not claim that any provider has approved this activity.
- It does not claim that any acquirer has approved this activity.
- It does not claim that Visa or Mastercard have approved or refused this
  activity.
- It does not claim that a final legal threshold has been established.
- It does not present any earlier provider's refusal as a statement by a card
  network, an acquiring bank or a regulator.

---

## Correspondance interne — quelle réponse remplit quelle case

*Interne. Ne pas transmettre.* Les points sont ceux de
`packages/domain/src/psp/qualification.ts`.

| Section du dossier | Point de qualification |
|---|---|
| §7 Q1 · Q2 | `ACQUIRING_ENTITY_IDENTIFIED` |
| §7 Q3 | `ACQUIRING_COUNTRY_IDENTIFIED` |
| §7 Q9 · Q10 | `MERCHANT_CATEGORY_CODE_CONFIRMED` |
| §1 · §7 Q4 | `ACTIVITY_ACCEPTED` |
| §3 | `PRODUCT_CATEGORIES_ACCEPTED` |
| §7 Q11 · §8 | `VISA_ACCEPTANCE_CONFIRMED` |
| §7 Q12 · §8 | `MASTERCARD_ACCEPTANCE_CONFIRMED` |
| §2 Model A | `MODEL_A_ACCEPTED` |
| §2 Model B | `MODEL_B_ACCEPTED` |
| §5 · §6 | `COMPLIANCE_CONDITIONS_STATED` |
| §11 | `RESERVE_CONDITIONS_STATED` |
| §10 | `CHARGEBACK_RULES_STATED` |
| §9 | `REFUND_RULES_STATED` |
| §2 A5 · A6 · B4 | `SETTLEMENT_RULES_STATED` |
| §14 · conditions de mise en service | `PRODUCTION_CONDITIONS_STATED` |
| §12 | `TERMINATION_CONDITIONS_STATED` |

`PROVIDER_IDENTIFIED` ne se coche pas à la réception d'une réponse : il exige un
engagement nominatif de Stripe — contrat ou décision de portail marchand — et
non un échange de messages, si favorable soit-il.

Une réponse laissée vide reste `UNKNOWN`. Une réponse favorable sans référence
retrouvable est enregistrée et ne qualifie pas : `assessQualification` la rend
`NOT_TRACEABLE`.
