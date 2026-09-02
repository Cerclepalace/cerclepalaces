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

¹ Refus écrit reçu le **21/08/2026**, **mais la référence d'archive n'est pas
encore consignée**.
Passe à `VERIFIED` dès que l'e-mail est archivé avec expéditeur, date et objet
identifiables. Tant que la trace n'est pas retrouvable, le niveau reste
`CONVERGENT` — le fait est tenu pour vrai, il n'est pas encore opposable.

² La preuve porte **uniquement sur l'état du ticket**, pas sur une décision. Une
demande de qualification formelle est **rédigée et non envoyée** au 2 septembre
2026 — cela ne change aucun axe : `PSP_STATUS` reste `UNKNOWN` jusqu'à un envoi
daté et prouvé.

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
  explicitement un transfert vers Risk / Compliance / Underwriting. Message prêt
  (`PSP-STRIPE-RELANCE.md`), dossier de qualification prêt à joindre
  (`PSP-STRIPE-DOSSIER.md`). Les deux couvrent les dix catégories de la
  taxonomie, les modèles A et B sans en choisir un, l'acquéreur, le MCC, Visa et
  Mastercard séparément, les remboursements, les impayés, les réserves et la
  résiliation. **`HUMAN DECISION REQUIRED`** — l'envoi est une action humaine,
  impossible depuis cet environnement ; la démarche reste `PREPARED` tant que la
  date d'envoi et sa preuve manquent.

### RoxPay et Stancer — refus écrits du 21 août 2026

- **SOURCE** — e-mails RoxPay et Stancer du 21/08/2026.
- **FAIT** — refus de l'activité présentée. Les deux invoquent des restrictions
  de **réseaux cartes**, de **banques acquéreuses** et de **régulateurs**, et
  précisent l'un comme l'autre que leur refus **ne met pas en cause la légalité
  de l'activité**.
- **STATUT** — `PSP_STATUS = REJECTED`, date 2026-08-21. Tous les autres axes
  restent `UNKNOWN`.
- **PREUVE** — `CONVERGENT`. La date et le contenu sont établis ; l'émetteur
  nommé et l'archive retrouvable manquent. Le refus est tenu pour vrai, il n'est
  pas encore opposable.
- **CE QUE CE MOTIF NE DIT PAS, ET C'EST LE POINT DÉLICAT DE CES DEUX DOSSIERS.**
  Un prestataire qui explique son refus en citant Visa, Mastercard, un acquéreur
  ou un régulateur ne parle **que de sa propre chaîne d'acceptation**. Ce n'est
  ni une décision de Visa, ni une décision de Mastercard, ni une décision d'un
  acquéreur nommé — aucun de ces tiers n'est identifié, aucun n'a écrit. Reporter
  ce motif sur les axes `CARD_NETWORK_STATUS` ou `ACQUIRER_STATUS` produirait
  exactement la phrase que ce registre interdit : « Visa et Mastercard refusent
  le CBD. » Elle reste fausse : elle n'est étayée par aucune pièce.
- **CE QUE CE MOTIF AJOUTE, EN REVANCHE** — deux prestataires indépendants
  situent le blocage **en amont d'eux-mêmes**. C'est cohérent avec le constat
  sectoriel déjà noté `CONVERGENT` plus bas : le goulot est l'acquéreur, pas la
  passerelle. Cela renforce la question centrale ; cela ne la résout pas.
- **ACTION** — consigner émetteur et objet pour passer à `VERIFIED`. Demander à
  RoxPay, en réponse dans le même fil, si le refus porte sur les deux modèles ou
  sur un seul : un refus du modèle A n'implique pas un refus du modèle B, et la
  distinction change les candidats suivants. **`HUMAN DECISION REQUIRED`** sur
  l'envoi ; le message ne peut pas partir depuis cet environnement.

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
| RoxPay | Refus écrit de l'activité, 21/08/2026 | Tout le reste — et notamment rien sur Visa, Mastercard, un acquéreur nommé ou un régulateur, bien que le motif les cite | Consigner émetteur et objet |
| Stancer | Refus écrit de l'activité, 21/08/2026 | Idem RoxPay | Idem RoxPay |
| Stripe | L'état du fil : mise en attente puis clôture administrative | **Aucune décision.** Ni refus, ni acceptation, sur aucun point | Envoyer la relance, dans le fil existant |
| Lemonway · emerchantpay · PayKings · BridgePay | Rien | Rien | Ouvrir ou verser au dossier une démarche datée |
| MangoPay | Un écart stratégique décidé par le projet | Un refus. Ce n'en est pas un | Aucune |

## Ce que le code sait maintenant représenter

Le dépôt ne pouvait pas exprimer l'état de ce dossier. « Acquéreur inconnu » et
« acquéreur approuvé » s'y ressemblaient : deux absences de `false`.

`packages/domain/src/psp/qualification.ts` porte désormais **dix-sept** points
comme un modèle typé — les quatorze d'origine, plus les trois ajoutés le
2 septembre 2026 par la revue de cohérence ci-dessous —, avec cinq réponses possibles — `YES`, `NO`,
`YES_WITH_CONDITIONS`, `NO_ANSWER`, `UNKNOWN` — et une liste fermée de sources.
Quatre d'entre elles engagent : e-mail écrit, contrat signé, courrier officiel,
décision du portail marchand. Les quatre autres — appel commercial, documentation
technique, accès bac à sable, page marketing — ne qualifient **jamais**, et un
test le vérifie pour chacune.

Trois propriétés, toutes vérifiées par mutation :

- **Le verdict par défaut est le refus.** Un dossier vide n'est pas « en
  attente », il est non qualifié sur les dix-sept points.
- **Un seul point manquant bloque.** Testé sur chacun des dix-sept séparément.
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

## Revue de cohérence — 2 septembre 2026

Revue en lecture seule du registre contre O-001 et les gates. Elle ne change
aucun statut ; elle dit où le dossier se contredit lui-même. Sept écarts, dont
quatre portent sur ce que le code **ne sait pas représenter** — et un trou de
représentation n'est pas neutre : il pousse à ranger un fait dans la case la
plus proche, ce qui est la définition même de l'inférence que ce registre
interdit.

### C-1 · `CARD_NETWORK_STATUS` était un axe obligatoire qu'aucun code ne portait

**`CLOS le 2 septembre 2026`** — deux points ajoutés,
`VISA_ACCEPTANCE_CONFIRMED` et `MASTERCARD_ACCEPTANCE_CONFIRMED`, avec un
groupe `CARD_NETWORK_POINTS` et `cardNetworksStillUnknown()`. Les neuf dossiers
vides passent de quatorze à dix-sept blocages avec `C-2` : **trois de plus,
jamais un de moins**.
Deux mutations le vérifient — retirer les points des dix-sept, ou y remettre
`PRODUCT_CATEGORIES_ACCEPTED`, casse quatre tests puis deux. Constat d'origine
ci-dessous, conservé.

`ACTION REQUISE À L'ORIGINE.` Les six axes ci-dessus imposent Visa et Mastercard
**séparément**. Les quatorze points de `qualification.ts` n'en contiennent
aucun, et `PSP-DEMANDE-TYPE.md` fait explicitement contribuer ses questions 6 et
7 — acceptation Visa, acceptation Mastercard — au point
`PRODUCT_CATEGORIES_ACCEPTED`.

Conséquence exacte : un prestataire qui répond `YES` sur les catégories de
produits sans dire un mot des réseaux fait passer ce point à `YES`. Le modèle
affiche alors une réponse là où l'information n'existe pas. C'est une inférence,
interdite par la règle « aucune ne s'infère d'une autre ».

Correction appliquée telle que proposée. Elle n'ajoute aucune logique
transactionnelle et ne présuppose aucun modèle de vente. Elle change en revanche
le décompte : **les quatorze points sont désormais dix-sept**, et les briefs qui
citent « quatorze » sont à mettre à jour.

### C-2 · Trois des douze confirmations n'avaient pas de case

**`CLOS le 2 septembre 2026`** — les trois ont désormais la leur :
`VISA_ACCEPTANCE_CONFIRMED`, `MASTERCARD_ACCEPTANCE_CONFIRMED` et
`TERMINATION_CONDITIONS_STATED`. Constat d'origine ci-dessous, conservé.

`ACTION REQUISE À L'ORIGINE.` La liste des douze confirmations à obtenir par écrit et la
liste des quatorze points typés ne se recouvrent pas. Trois éléments des douze
n'ont aucun équivalent dans le code :

| Confirmation exigée | Point correspondant |
|---|---|
| 4 · Acceptation Visa | aucun → `VISA_ACCEPTANCE_CONFIRMED` |
| 5 · Acceptation Mastercard | aucun → `MASTERCARD_ACCEPTANCE_CONFIRMED` |
| 12 · Conditions de résiliation et de fonds | aucun — `PRODUCTION_CONDITIONS_STATED` porte le passage en production, pas la sortie → `TERMINATION_CONDITIONS_STATED` |

Une confirmation sans case ne peut pas manquer visiblement : elle est oubliée en
silence. C'est le contraire de ce que le registre est censé garantir.

### C-3 · `EVIDENCE_LEVEL` n'existe que dans le Markdown

`ACTION REQUISE.` `VERIFIED` · `CONVERGENT` · `UNVERIFIED` est un axe imposé,
tenu uniquement dans le tableau ci-dessus. `registre.ts` connaît `reference`
— présente ou absente — ce qui ne distingue pas un refus daté sans archive
(`CONVERGENT`) d'une page marketing (`UNVERIFIED`). Le tableau et le fichier
typé peuvent donc diverger sur cet axe précis, alors que le fichier typé a été
écrit pour empêcher exactement cela.

### C-4 · `PSP-DEMANDE-TYPE.md` se contredit sur sa propre règle

`FAIT / PREUVE.` Le document affirme que « chaque question porte **un seul** des
quatorze points ». Sa propre table de correspondance dit autre chose : les
questions 6 et 7 partagent un point, la question 10 n'en porte aucun, la
question 14 en porte deux. La règle énoncée est fausse pour quatre questions sur
quinze. Corriger la phrase, pas la table : la table décrit ce que les questions
font réellement.

### C-5 · États vendeur — le brief liste neuf états, le code en a six

`FAIT / PREUVE.` Le code et la base sont d'accord entre eux
(`MERCHANT_STATUSES`, `enum MerchantStatus`) : `PENDING_VALIDATION`,
`KYB_REVIEW`, `APPROVED`, `ACTIVE`, `SUSPENDED`, `CLOSED`. Les briefs citent
`APPLIED`, `KYB_PENDING`, `REJECTED`, `BLOCKED`, `OFFBOARDED` — aucun de ces
cinq n'existe nulle part dans le dépôt, et `PENDING_VALIDATION` comme `CLOSED`
n'apparaissent pas dans le brief. Ce n'est pas une divergence bénigne : une
migration ne peut pas être planifiée sur une liste d'états imaginaire.
**`HUMAN DECISION REQUIRED`** — soit le brief est mis à jour, soit une évolution
d'états est décidée et migrée.

### C-6 · États produit — `DRAFT` n'existe pas

`FAIT / PREUVE.` `COMPLIANCE_STATUSES` en compte cinq : `PENDING_REVIEW`,
`APPROVED`, `REJECTED`, `SUSPENDED`, `EXPIRED`. `DRAFT` n'existe ni dans le
domaine ni dans le schéma. À noter : cette machine décrit la **conformité** d'un
produit, pas sa publication commerciale ; un `DRAFT` y aurait un sens différent
de celui que le mot suggère.

### C-7 · `DEFAULT_THC_THRESHOLD_PERCENT` n'existe pas, et ne doit pas être créé

`FAIT / PREUVE.` La constante citée dans les briefs est absente du dépôt. La
valeur `0.3` n'y figure que dans des **fixtures de test**, où elle joue le rôle
d'un plafond arbitraire pour vérifier une comparaison — jamais celui d'un seuil
réglementaire. La décision 10 est ouverte ; écrire cette constante trancherait
un seuil réglementaire en silence, ce qu'interdit la règle « ne jamais inventer
un seuil réglementaire ». **`LEGAL VALIDATION REQUIRED`** avant toute valeur.

### Ce que la revue n'a pas trouvé

Aucune contradiction entre le registre et O-001. Le gel transactionnel est
cohérent de bout en bout : aucun dossier n'est qualifié, `assertProviderQualified()`
n'est appelée nulle part, la garde anti-monétaire passe, et aucun statut du
registre ne pourrait, même modifié, ouvrir un chemin d'encaissement. Aucun
dossier n'est enregistré comme envoyé, ce qui est exact : rien ne peut partir
depuis cet environnement.

## Conséquence sur le reste du code

Aucune. `O-001` reste **CONDITIONAL / NO-GO**. Le périmètre transactionnel est
gelé et la garde anti-monétaire le vérifie à chaque exécution des tests. Aucun
développement de checkout, ledger, wallet, payout, remboursement, chargeback,
réserve ou comptabilité transactionnelle ne commence avant que les gates
juridique, fiscale, PSP et acquiring ne soient toutes `APPROVED`.
