# Stripe — message de réouverture

> À envoyer **en réponse dans le fil existant**, jamais dans un nouveau ticket :
> l'historique du dossier est ce qui donne son poids à la demande, et un fil neuf
> repartirait de zéro devant un support qui ne verrait pas l'antériorité.

Avant d'envoyer, remplacer `[Email]` et `[Telephone]`. Ne rien changer d'autre
sans raison : le message est construit pour être transféré tel quel à une équipe
Risk, et chaque question numérotée est destinée à recevoir une réponse écrite
séparée.

---

**Subject:** Re: Pre-approval request — French multi-vendor CBD marketplace

Hello Stripe Support / Risk Team,

Thank you for your message. We would like to reopen this request and provide the information needed for a formal eligibility assessment.

We are evaluating Stripe for a French multi-vendor marketplace operated by a French company. The marketplace would onboard professional third-party sellers, conduct seller KYB/KYC, collect customer payments, deduct a marketplace commission and arrange seller payouts to verified bank accounts.

We are not requesting technical integration approval at this stage. We are requesting a written Risk / Compliance / Underwriting assessment before any live payment activity.

Initial product categories under review are:

- CBD-free accessories;
- CBD cosmetics;
- CBD oils exclusively positioned for topical and non-food use;
- CBD flowers;
- CBD resins.

Excluded from the initial scope are vaping products, food, beverages, supplements, ingestible CBD oils, HHC, THCP, H4CBD and other non-approved cannabinoid derivatives.

Could you please forward this request to the appropriate Risk, Compliance, Underwriting or Restricted Businesses team and provide written confirmation on the following points?

1. Can Stripe onboard a French company operating this multi-vendor marketplace model?

2. Can Stripe Connect support professional third-party sellers, seller KYB/KYC, customer payments, marketplace commissions and seller payouts for this model?

3. For each category below, please confirm: eligible, ineligible, restricted, or subject to enhanced underwriting:
- CBD-free accessories;
- CBD cosmetics;
- topical/non-food CBD oils;
- CBD flowers;
- CBD resins.

4. Does this business require written pre-approval before any processing activity?

5. Which legal Stripe entity and acquiring arrangement would process transactions for a French merchant?

6. What MCC would apply to the marketplace and would it vary according to the products sold?

7. Would Visa and Mastercard card acceptance be available for each eligible category?

8. Are there any reserve, delayed payout, fund-hold, chargeback or termination conditions specific to this model?

9. Can Stripe provide a written decision covering the combined scope:
French marketplace + professional third-party sellers + CBD categories + marketplace commission + seller payouts?

We understand that any final onboarding decision remains subject to full KYB, underwriting, contractual review, product documentation and ongoing monitoring.

Please let us know which documents you require for the assessment.

Kind regards,

Noa Durand
Project: cbd-Shop
France
[Email]
[Telephone]

---

## Après l'envoi

Consigner dans `PSP-REGISTRE.md` : date d'envoi, référence du fil, et
`PSP_STATUS = IN_PROGRESS`. Un envoi daté fait passer de `UNKNOWN` à
`IN_PROGRESS` ; il ne fait rien d'autre.

Ce qu'une réponse **ne suffira pas** à établir, même favorable : l'identité de
l'acquéreur, le MCC, l'acceptation Visa et l'acceptation Mastercard. Ces quatre
points doivent être confirmés nommément — les questions 5, 6 et 7 sont là pour
cela, et une réponse qui les élude les laisse à `UNKNOWN`.

Si le fil se referme à nouveau sans décision, le statut reste `UNKNOWN`. Une
seconde clôture administrative n'est pas davantage un refus que la première.
