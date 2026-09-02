# Registre PSP et acquiring — qualification transactionnelle

> **Décision 09 de `TO_VERIFY.md`.** Ce document est la source unique de l'état
> de qualification des prestataires de paiement. Rien ici n'autorise quoi que ce
> soit : O-001 reste **CONDITIONAL / NO-GO**, et le code refuse toute opération
> de paiement (`NoopPaymentProvider`).

## Méthode

Chaque ligne suit la même chaîne, et aucun maillon n'est déduit d'un autre :

```
SOURCE → FAIT → STATUT → PREUVE → INFERENCE (si applicable) → ACTION
```

Quand une information manque, elle est écrite `UNKNOWN`. Elle n'est jamais
comblée par une supposition.

### Six axes, jamais confondus

| Axe | Ce qu'il mesure |
|---|---|
| `PSP_STATUS` | Décision du prestataire sur le dossier soumis |
| `ACQUIRER_STATUS` | Décision de l'établissement qui porte le risque cartes |
| `MCC_STATUS` | Code d'activité retenu, et sa stabilité selon les produits |
| `CARD_NETWORK_STATUS` | Acceptation Visa et Mastercard, séparément |
| `COMPLIANCE_STATUS` | Position écrite d'une équipe Risk / Compliance / Underwriting |
| `EVIDENCE_LEVEL` | `VERIFIED` · `CONVERGENT` · `UNVERIFIED` |

Valeurs de statut : `UNKNOWN` · `IN_PROGRESS` · `APPROVED` · `REJECTED` ·
`BLOCKED`.

### Quatre règles qui ne se négocient pas

1. **Un PSP n'est pas un acquéreur.** Le refus de l'un ne dit rien de l'autre.
2. **Une capacité technique n'est pas une acceptation.** Une API marketplace
   documentée, un module KYC, un split de paiement : ce sont des fonctions
   vendues, pas une décision de souscription du risque.
3. **Une absence de réponse n'est jamais un refus.** Une clôture administrative
   de ticket non plus.
4. **`VERIFIED` exige une trace nommée** : émetteur identifiable, date, contenu
   citable, archive retrouvable. C'est la même exigence que le registre de
   preuves juridiques du code — une case cochée sans auteur ne prouve rien.

## Registre au 2 septembre 2026

Ce tableau est désormais **doublé par un fichier typé**,
`packages/domain/src/psp/registre.ts`, confronté à des tests. Un tableau tenu à
la main dérive ; un registre qui affirmerait qu'un prestataire est qualifié
alors qu'il ne l'est pas fait échouer la suite.

| Prestataire | PSP_STATUS | ACQUIRER | MCC | RÉSEAUX | COMPLIANCE | PREUVE |
|---|---|---|---|---|---|---|
| Nuvei | `REJECTED` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `NOT_OBTAINED` | `VERIFIED` |
| RoxPay | `REJECTED` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `CONVERGENT` ¹ |
| Stancer | `REJECTED` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `CONVERGENT` ¹ |
| Stripe | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `VERIFIED` ² |
| Lemonway | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNVERIFIED` |
| emerchantpay | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNVERIFIED` |
| PayKings | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNVERIFIED` ³ |
| BridgePay | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNVERIFIED` ³ |
| MangoPay | `EXCLUDED_AT_THIS_STAGE` | — | — | — | — | Décision projet ⁴ |

¹ Refus écrit reçu, **mais la référence d'archive n'est pas encore consignée**.
Passe à `VERIFIED` dès que l'e-mail est archivé avec expéditeur, date et objet
identifiables. Tant que la trace n'est pas retrouvable, le niveau reste
`CONVERGENT` — le fait est tenu pour vrai, il n'est pas encore opposable.

² La preuve porte **uniquement sur l'état du ticket**, pas sur une décision.

³ Aucun contenu de réponse n'a été porté à ce registre. Voir plus bas.

⁴ Écart stratégique décidé par le projet, **pas un refus écrit**. Ne jamais le
compter parmi les refus.

## Dossiers

### Nuvei — refus écrit

- **SOURCE** — e-mail Nuvei du 26/08/2026.
- **FAIT** — « Based on location and business we would not be able to assist
  this business with services. » La demande était présentée comme
  *Pre-approval request — French multi-vendor CBD marketplace*.
- **STATUT** — `PSP_STATUS = REJECTED`, date 2026-08-26, périmètre *French
  multi-vendor CBD marketplace*.
- **PREUVE** — `VERIFIED`.
- **CE QUE CE REFUS NE DIT PAS** — rien sur l'acquéreur de Nuvei, rien sur un
  MCC, rien sur Visa, rien sur Mastercard, rien sur le CBD en général. Il porte
  sur *le dossier soumis*, et le motif cité mêle localisation et activité sans
  les distinguer.
- **À CONSERVER SÉPARÉMENT** — le dossier Nuvei documente des **capacités
  techniques et commerciales** : marketplace, multi-vendor, KYC, split, payouts,
  refunds, chargebacks, réconciliation, Merchant of Record. Ces éléments restent
  utiles comme référence fonctionnelle. Ils ne constituent **aucune** acceptation
  de l'activité CBD.

  ```
  TECHNICAL_CAPABILITY = documentée
  CBD_ACCEPTANCE       = refusée pour le dossier soumis
  ```
- **ACTION** — archiver l'e-mail avec sa référence. Éventuellement demander, en
  réponse, si le refus vise la localisation, l'activité, ou les deux : la
  distinction change les candidats suivants. Facultatif, non bloquant.

### Stripe — non qualifié, pas refusé

- **SOURCE** — deux messages du support Stripe.
- **FAIT n°1** — le dossier est « on hold while we await your response to our
  previous note ».
- **FAIT n°2** — Stripe clôt la demande de support, en indiquant qu'elle peut
  être rouverte en répondant directement à l'e-mail.
- **STATUT** — `PSP_STATUS = UNKNOWN`, `TICKET_STATUS = CLOSED_ADMINISTRATIVELY`.
  Tous les autres axes : `UNKNOWN`.
- **PREUVE** — `VERIFIED` sur l'état du ticket. **Aucune** sur une décision.
- **CE QUI N'EXISTE PAS DANS CES MESSAGES** — refus Compliance, refus Risk, refus
  Underwriting, refus de Stripe Connect, refus d'acquéreur, refus Visa, refus
  Mastercard, refus de MCC. Aucun.
- **ACTION** — rouvrir dans le même fil, pour conserver l'historique, et demander
  explicitement un transfert vers Risk / Compliance / Underwriting. Message prêt,
  voir `PSP-STRIPE-RELANCE.md`.

### PayKings et BridgePay — rien à classer

- **SOURCE** — aucune réponse n'a été portée à ce registre à ce jour.
- **FAIT** — `UNKNOWN`.
- **STATUT** — `UNKNOWN` si aucun envoi n'est confirmé, `IN_PROGRESS` si un envoi
  est daté et archivé. **Jamais `REJECTED` par défaut.**
- **ACTION** — si des réponses existent, les verser au dossier. Chaque réponse
  doit être lue contre cette grille, point par point :

  | Question | Réponse attendue |
  |---|---|
  | CBD accepté ou refusé ? | oui / non / sous conditions |
  | Marketplace acceptée ? | oui / non |
  | Modèle A (shop vendeur) accepté ? | oui / non |
  | Modèle B / Merchant of Record accepté ? | oui / non |
  | Acquéreur nommé ? | entité identifiée / `UNKNOWN` |
  | MCC nommé ? | code / `UNKNOWN` |
  | Visa confirmé explicitement ? | oui / non / `UNKNOWN` |
  | Mastercard confirmé explicitement ? | oui / non / `UNKNOWN` |
  | Réserve ? | montant, durée, déclencheur |
  | Chargebacks ? | seuils, pénalités |
  | Payouts ? | délai, conditions de blocage |
  | Restrictions géographiques ? | pays inclus / exclus |
  | Motif exact si refus ? | citation littérale |

  Une réponse qui laisse une case vide laisse cette case à `UNKNOWN`. On ne
  complète pas par déduction.

## La question centrale

Trouver un prestataire qui possède une API marketplace ne résout rien. La
question à poser, et à faire écrire, est celle-ci :

> **Quelle est l'entité acquéreur qui souscrirait le risque des transactions
> cartes pour cette activité, et cet acquéreur a-t-il approuvé le CBD ainsi que
> le modèle marketplace / Merchant of Record proposé ?**

Douze confirmations doivent être obtenues **séparément**, chacune par écrit :

```
1. PSP approval                    7. Acceptation du modèle marketplace / MoR
2. Acquirer approval               8. Conditions de payout
3. MCC confirmé                    9. Conditions de remboursement
4. Acceptation Visa               10. Conditions de chargeback
5. Acceptation Mastercard         11. Conditions de réserve
6. Acceptation catégorie CBD      12. Conditions de résiliation et de fonds
```

Aucune ne s'infère d'une autre. Un « oui » global sans ces douze points reste
`UNKNOWN` sur les onze restants.

## Candidats suivants — à qualifier, rien de plus

**Niveau de preuve : `UNVERIFIED` pour tous.** Ce qui suit est une piste de
prospection, pas un classement. Les sources sont des pages commerciales et des
comparatifs sectoriels : elles décrivent ce que des prestataires *déclarent
accepter*, ce qui n'est ni une décision de souscription ni une position
d'acquéreur. Une page annonçant « 100 % d'approbation » est un argument de
vente ; elle ne vaut rien dans ce registre.

| Candidat | Pourquoi le contacter | Statut |
|---|---|---|
| Worldpay | Souscrirait le CBD au cas par cas via une équipe spécialisée, selon les comparatifs sectoriels | `UNKNOWN` |
| Nomupay | Positionnement explicite sur le CBD après rachat d'un spécialiste high-risk britannique | `UNKNOWN` |
| Fibonatix | Acceptation CBD annoncée, orientation européenne | `UNKNOWN` |
| Wallid | Acceptation CBD annoncée | `UNKNOWN` |
| Lemonway | Déjà au registre, agréé établissement de paiement français, orienté marketplace — le volet CBD reste entier | `UNKNOWN` |
| emerchantpay | Déjà au registre, orientation high-risk européenne | `UNKNOWN` |

Deux constats sectoriels, cohérents entre plusieurs sources, à traiter comme
`CONVERGENT` et non comme des faits établis :

- **Le goulot est l'acquéreur, pas la passerelle.** La rareté porte sur les
  banques acquéreuses acceptant de souscrire le chanvre, pas sur les
  intégrations techniques. C'est ce qui justifie la question centrale ci-dessus.
- **Le multi-MID est une pratique courante** sur ces activités : plusieurs
  identifiants marchands chez plusieurs acquéreurs, pour ne pas dépendre d'un
  seul. À considérer plus tard, pas maintenant — cela suppose d'abord une
  première approbation.

Un chiffre de coût circule dans ces comparatifs — de l'ordre de 3,5 % à 4,5 % par
transaction. Il est noté ici comme ordre de grandeur `UNVERIFIED`, à ne jamais
reprendre dans un modèle économique avant d'avoir une grille tarifaire signée.

## Formulation

La seule formulation exacte de l'état du dossier est celle-ci :

> Trois PSP — RoxPay, Stancer et Nuvei — ont fourni des refus écrits concernant
> le dossier soumis. Stripe reste non qualifié après clôture administrative du
> ticket. Les acquéreurs, MCC et réseaux cartes restent à qualifier séparément,
> sauf preuve documentaire contraire.

Ce qui ne doit pas être écrit, parce que ce serait faux :

- « Tous les PSP ont refusé cbd-Shop. »
- « Stripe nous a refusés. »
- « Nuvei prouve que l'acquiring refuse le CBD. »
- « Visa et Mastercard refusent le CBD. »
- « Le CBD est interdit. »
- « Trois refus prouvent que le projet est impossible. »

## Ce que chaque preuve établit, et ce qu'elle n'établit pas

| Prestataire | La preuve établit | Elle n'établit pas | Action suivante |
|---|---|---|---|
| Nuvei | Refus de l'activité sur le dossier soumis, 26/08/2026 | Acquéreur, code d'activité, réseaux, modèles A et B, position sur le CBD en général | Consigner la référence d'archive. Éventuellement demander si le motif vise la localisation, l'activité, ou les deux |
| RoxPay | Refus écrit reçu | Tout le reste ; et la référence d'archive n'est pas consignée | Consigner émetteur, date, objet |
| Stancer | Refus écrit reçu | Idem RoxPay | Idem RoxPay |
| Stripe | L'état du fil : mise en attente puis clôture administrative | **Aucune décision.** Ni refus, ni acceptation, sur aucun point | Envoyer la relance, dans le fil existant |
| Lemonway · emerchantpay · PayKings · BridgePay | Rien | Rien | Ouvrir ou verser au dossier une démarche datée |
| MangoPay | Un écart stratégique décidé par le projet | Un refus. Ce n'en est pas un | Aucune |

## Ce que le code sait maintenant représenter

Le dépôt ne pouvait pas exprimer l'état de ce dossier. « Acquéreur inconnu » et
« acquéreur approuvé » s'y ressemblaient : deux absences de `false`.

`packages/domain/src/psp/qualification.ts` porte désormais les quatorze points
ci-dessus comme un modèle typé, avec cinq réponses possibles — `YES`, `NO`,
`YES_WITH_CONDITIONS`, `NO_ANSWER`, `UNKNOWN` — et une liste fermée de sources.
Quatre d'entre elles engagent : e-mail écrit, contrat signé, courrier officiel,
décision du portail marchand. Les quatre autres — appel commercial, documentation
technique, accès bac à sable, page marketing — ne qualifient **jamais**, et un
test le vérifie pour chacune.

Trois propriétés, toutes vérifiées par mutation :

- **Le verdict par défaut est le refus.** Un dossier vide n'est pas « en
  attente », il est non qualifié sur les quatorze points.
- **Un seul point manquant bloque.** Testé sur chacun des quatorze séparément.
- **Le prestataire n'est pas l'acquéreur.** `acquiringStillUnknown()` dit
  précisément « ils ont répondu, personne ne sait qui souscrit » — la phrase la
  plus fréquente de ce dossier, qu'un statut unique rendrait indicible.

Une garde, `assertProviderQualified()`, existe sans être appelée : rien
n'encaisse. Elle est écrite maintenant pour que le jour où un adaptateur réel
sera branché, l'oublier soit une omission visible plutôt qu'un chemin par défaut.

Les **neuf dossiers réels** sont transcrits dans `psp/registre.ts`, avec une
règle de saisie sans exception : une case ne reçoit une valeur que si une preuve
la porte. Nuvei porte un seul point renseigné — le refus d'activité — parce que
son e-mail ne dit rien d'autre ; en déduire que l'acquéreur ou les modèles sont
refusés serait exactement l'erreur que ce registre existe pour empêcher. Stripe
n'en porte aucun, parce qu'aucune décision n'a été rendue.

Un dossier sépare trois choses qui ne se mélangent jamais : ce qu'un prestataire
**sait faire**, ce qu'il a **accepté**, et ce qu'on lui a **demandé**. La
séparation est structurelle — la fonction de jugement ne reçoit jamais les
capacités, donc aucune ne peut faire pencher un verdict. Une mutation qui ferait
qualifier un prestataire sur ses seules capacités casse cinq tests.

Les démarches distinguent **préparé** et **envoyé**. Un message rédigé, relu,
prêt à partir ressemble à un dossier en cours ; tant que la date d'envoi et sa
preuve manquent, personne n'attend de réponse. Aucune démarche du registre n'est
enregistrée comme envoyée : rien n'a été expédié depuis cet environnement.

Un contrat de port, `payment-provider.contract.test.ts`, décrit ce que tout
adaptateur devra satisfaire — sans citer un seul nom de prestataire, et un test
vérifie qu'il n'en cite aucun. Une suite écrite après coup pour un fournisseur
donné ne testerait plus rien.

## Conséquence sur le reste du code

Aucune. `O-001` reste **CONDITIONAL / NO-GO**. Le périmètre transactionnel est
gelé et la garde anti-monétaire le vérifie à chaque exécution des tests. Aucun
développement de checkout, ledger, wallet, payout, remboursement, chargeback,
réserve ou comptabilité transactionnelle ne commence avant que les gates
juridique, fiscale, PSP et acquiring ne soient toutes `APPROVED`.
