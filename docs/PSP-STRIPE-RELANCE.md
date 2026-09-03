# Stripe — message de réouverture

> À envoyer **en réponse dans le fil existant**, jamais dans un nouveau ticket :
> l'historique du dossier est ce qui donne son poids à la demande, et un fil neuf
> repartirait de zéro devant un support qui ne verrait pas l'antériorité.
>
> Avant d'envoyer, remplacer `[Email]` et `[Telephone]`. Ne rien changer d'autre
> sans raison : le message est construit pour être transféré tel quel à une
> équipe Risk, et chaque question numérotée est destinée à recevoir une réponse
> écrite séparée.
>
> **Révision du 2 septembre 2026.** La version précédente présentait un
> périmètre produit restreint — cinq catégories, le reste annoncé comme exclu.
> Ce n'était pas faux, mais cela pré-tranchait : nous décidions à la place de
> Stripe ce qu'il refuserait. Le message présente désormais les **dix
> catégories** de la taxonomie et demande une qualification de chacune. C'est
> une demande plus large et une réponse plus exploitable : un refus catégorie
> par catégorie est une information ; un périmètre auto-restreint n'en est pas
> une.
>
> Le dossier détaillé qui accompagne ce message est `PSP-STRIPE-DOSSIER.md`. Il
> est fait pour être joint ou transmis tel quel à l'équipe qui instruira.

---

**Subject:** Re: Pre-approval request — French multi-vendor CBD marketplace

Hello Stripe Support / Risk Team,

Thank you for your earlier messages. We understand the support request was
closed administratively while awaiting our reply, and we are reopening it here
in the same thread so that the history stays attached to the file.

We would like to request a **formal written eligibility assessment** before any
live payment activity. We are not asking for technical integration support, and
we are not asking the general question "does Stripe accept CBD" — that question
is too broad to be answered usefully. We are asking for a review of one specific
business, described below.

Could you please forward this to the appropriate Risk, Compliance, Underwriting
or Restricted Businesses team?

---

**1. Context and activity**

A French company operating a multi-vendor marketplace selling CBD and
hemp-derived consumer products in France. Sellers are professional businesses,
onboarded through KYB, beneficial-owner identification and sanctions screening.
Products are reviewed individually before listing, against a closed taxonomy, a
certificate of analysis and prohibited-substance screening. Delivery is operated
through a courier network.

The platform is currently pre-transactional: no payment provider is integrated,
no funds are collected, and no payout or ledger mechanism exists. Nothing will
be built on the payment side until this assessment is complete.

**2. Product taxonomy — please qualify each category separately**

We are not asserting that all of these are acceptable. We are asking you to
qualify each one as **YES**, **NO**, or **YES SUBJECT TO WRITTEN CONDITIONS**:

1. `FLOWER` — CBD hemp flower
2. `RESIN` — CBD hemp resin
3. `OIL_NON_FOOD` — CBD oils positioned for topical, non-ingestible use
4. `COSMETIC` — CBD cosmetics
5. `SUPPLEMENT` — food supplements containing CBD
6. `FOOD` — foodstuffs and beverages containing CBD
7. `VAPE` — vaping products containing CBD
8. `ACCESSORY` — accessories containing no CBD
9. `OTHER` — unclassified; never listed, awaits human classification
10. `PROHIBITED_DERIVATIVE` — **excluded by design**, structurally closed in the
    platform so that a product falling into it is named and refused rather than
    silently classified elsewhere

Excluded from our scope by project decision: HHC, HHC-O, HHCP, HHCPO, H4-CBD,
H2-CBD and THCP. We state this as our own commercial and compliance scope, not
as a statement of law.

**3. Two possible legal models — we are asking you to qualify both**

We have deliberately not chosen between them, because the choice depends in part
on your answer.

*Model A — Marketplace / Intermediary.* The third-party seller remains the
contractual seller to the customer; cbd-Shop operates the marketplace and
receives a platform fee. Please confirm: whether Stripe accepts this structure;
whether CBD sellers can be onboarded and under what account status; what KYB/KYC
is required of them; whether payments can be split; whether seller payouts are
permitted; who is responsible for refunds; who is responsible for chargebacks;
who bears a negative balance arising after a payout; which acquiring entity is
involved; which MCC applies; and whether the card networks accept this structure.

*Model B — Merchant of Record.* cbd-Shop becomes the contractual seller to the
customer and third-party businesses become suppliers. Please confirm: whether
Stripe accepts this structure; whether CBD is acceptable under it; what
underwriting is required; how suppliers may be paid; how refunds operate; how
chargebacks operate; who carries the economic liability; which acquiring entity
is involved; which MCC applies; and what restrictions apply.

A "yes" on one model will not be read by us as a "yes" on the other. If only one
is acceptable, please say which.

**4. Acquiring — the central question**

> Which acquiring entity would underwrite the card transaction risk for this
> activity, and has that entity approved CBD as well as the proposed marketplace
> / Merchant of Record model?

Specifically:

1. Which acquiring entity would be used?
2. What is its legal name?
3. In which country is it established?
4. Has it reviewed CBD as an activity?
5. Has it reviewed the marketplace model?
6. Has it reviewed Model A?
7. Has it reviewed Model B?
8. Is the file APPROVED, REJECTED, IN PROGRESS or not yet examined?
9. Which MCC would be used?
10. Is that MCC confirmed, or indicative?
11. Does Visa impose specific conditions on this activity?
12. Does Mastercard impose specific conditions on this activity?
13. Which countries are included, and which excluded, for selling and for shipping?
14. Do restrictions apply to cardholder location as distinct from merchant location?

Our operating scope at launch is France. We ask questions 13 and 14 explicitly
rather than assume that a French merchant account implies French-only
restrictions, or that it implies none.

We record provider, acquirer and card-network answers in separate fields. We
will not read an answer to one as an answer to another, and a general statement
that something "is supported by Stripe" will be recorded as a statement about
Stripe rather than as Visa or Mastercard acceptance.

**5. Compliance controls in place**

Seller KYB/KYC; beneficial-owner checks; sanctions screening; product approval
before listing; category controls against the closed taxonomy; certificate of
analysis per product; laboratory identity; lot/batch identification; certificate
issue and expiry dates, with expiry enforced; THC and cannabinoid information
recorded as declared and certified; prohibited-substance screening including
alternative spellings; a single listing gate that returns every failing reason
rather than the first; suspension of individual sellers and products; and an
audit trail of compliance decisions with the deciding party and date.

On THC levels, so that we are precise rather than reassuring: the technical test
threshold currently used by the project is not presented as final legal
evidence. The final legal threshold remains subject to legal validation. No
regulatory threshold is hard-coded in the platform; declared and certified
levels are recorded as declared.

**6. Refunds**

Please state the treatment of: full refund; partial refund; refund before
payout; refund after payout; refund after seller suspension; refund after seller
termination; insufficient seller balance; negative balance; fees; and reserve.

**7. Chargebacks**

Please state: who is the merchant of record for card scheme purposes; who
responds to the chargeback; who supplies the evidence; who bears the economic
loss; seller liability; platform liability; treatment after payout; negative
balance; reserve; suspension; and termination.

**8. Reserves and risk controls**

Please state: rolling reserve; fixed reserve; initial reserve; percentage;
duration; release conditions; increase triggers; payout delays; transaction
limits; risk controls; and the negative balance mechanism.

**9. Suspension and termination**

Please state: compliance freeze; payment suspension; payout suspension; reserve
increase; termination; notice period; pending transactions; refunds after
termination; chargebacks after termination; and the treatment of remaining
funds.

**10. Answer format we are asking for**

For each critical point: **YES**, **NO**, or **YES SUBJECT TO WRITTEN
CONDITIONS** — and, where conditions exist, the exact conditions.

We would rather receive a partial written answer with the remaining points
explicitly marked unanswered than a general favourable statement we could not
rely on later. An explicit "we cannot answer this point" is genuinely useful to
us, and we will not treat it as a refusal.

**11. Documents available on request**

Company registration and statutes; beneficial-owner information; seller
onboarding procedure and KYB checklist; product approval procedure and listing
gate rules; a sample certificate of analysis and the fields we require from a
laboratory; the product taxonomy definition; prohibited-substance screening
rules; projected volumes and average basket, marked as projections; and the
delivery model description.

Please let us know which of these you require, and in which format.

We understand that any final onboarding decision remains subject to full KYB,
underwriting, contractual review, product documentation and ongoing monitoring.

Kind regards,

Noa Durand
Project: cbd-Shop
France
[Email]
[Telephone]

---

## Coordonnées

`[Email]` et `[Telephone]` sont des **placeholders**. Aucune coordonnée réelle
n'est écrite dans ce dépôt : un document destiné à sortir n'est pas l'endroit où
inventer, ni où recopier, une adresse. Les remplacer est la première des deux
actions manuelles.

## Avant l'envoi

Rien de ce message ne peut partir depuis l'environnement de développement.
L'envoi est une **action humaine**.

## Après l'envoi

Trois valeurs sont à relever au moment de l'envoi, et à reporter dans
`PSP-REGISTRE.md` **et** dans `packages/domain/src/psp/registre.ts` :

| Placeholder | Ce qu'il attend | Champ du registre |
|---|---|---|
| `[STRIPE THREAD REFERENCE]` | identifiant du fil ou du ticket rouvert | `threadReference` |
| `[DATE OF ACTUAL SENDING]` | date réelle de l'envoi | `sentAt` |
| `[PROOF OF SENDING]` | accusé, identifiant de message, capture | `proofOfSending` |

`isActuallySent()` exige **la date et la preuve** — sans les deux, la démarche
reste `PREPARED`, ce qui est exact tant que rien ne permet de prouver l'envoi.
Les trois valeurs sont aujourd'hui absentes du registre, et le resteront tant
qu'elles ne seront pas réellement disponibles : y écrire une date plausible
ferait attendre une réponse que personne n'a demandée.

Un envoi daté fait passer `PSP_STATUS` de `UNKNOWN` à `IN_PROGRESS`. Il ne fait
rien d'autre : il n'ouvre aucun axe, et surtout pas ceux de l'acquéreur.

## Ce qu'une réponse, même favorable, ne suffira pas à établir

Quatre points au moins resteront `UNKNOWN` si la réponse les élude : l'identité
de l'acquéreur, le MCC confirmé, l'acceptation Visa et l'acceptation Mastercard.
Les questions 4.1 à 4.12 sont là pour cela, et une réponse qui les contourne les
laisse tous à `UNKNOWN`.

Rappel des trois inférences interdites, parce qu'elles sont faciles à écrire
sans y penser :

- « Stripe accepte, donc Visa accepte. »
- « Stripe accepte, donc Mastercard accepte. »
- « Un autre prestataire a cité Visa pour nous refuser, donc Visa refuse le CBD. »

Aucune n'est étayée par une pièce émanant d'un réseau cartes. `qualification.ts`
porte désormais `VISA_ACCEPTANCE_CONFIRMED` et
`MASTERCARD_ACCEPTANCE_CONFIRMED` comme deux points séparés précisément pour que
ces phrases restent indicibles dans le modèle.

## Si le fil se referme à nouveau

Le statut reste `UNKNOWN`. Une seconde clôture administrative n'est pas
davantage un refus que la première — et l'enregistrer comme tel inventerait une
décision que personne n'a prise.
