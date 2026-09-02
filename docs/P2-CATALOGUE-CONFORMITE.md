# P2 — Catalogue et conformité

> Ce document décrit ce qui est **construit et testé**. Ce qui manque est nommé
> à la fin.

## Le principe qui gouverne toute la tranche

**Aucune règle de droit n'est écrite dans le code.** Le code contient le
mécanisme qui applique une politique ; la politique est une donnée fournie par
l'exploitant. Aucun seuil, aucune catégorie, aucune substance n'apparaît en dur.

Ce n'est pas de la prudence de façade : les valeurs réglementaires ne sont pas
arrêtées (décisions 03 et 10), et les figer dans du code reviendrait à affirmer
un droit que personne n'a vérifié. Un test vérifie explicitement cette
propriété — sans politique fournie, le code est **incapable** de statuer sur un
taux, et deux politiques différentes rendent deux verdicts différents sur le
même produit.

## Trois réponses, pas deux

Une catégorie ou un analyte est **autorisé**, **interdit**, ou **non tranché**.

Le troisième cas est le plus important, parce que c'est celui qui existe
réellement aujourd'hui sur presque tout. Le confondre avec « autorisé » ferait
vendre par défaut ce que personne n'a examiné. Une politique vide interdit donc
tout — c'est le comportement correct d'un système qui ne sait pas encore.

## Autoriser et interdire ne coûtent pas la même chose

**Autoriser exige au moins une preuve juridique vérifiée. Interdire n'exige
rien.**

Refuser de vendre n'a jamais besoin d'être justifié par une source : se tromper
dans ce sens coûte une vente, se tromper dans l'autre coûte autre chose.
L'asymétrie est volontaire et se lit dans le code.

### Ce qu'est une preuve

| Champ | Rôle |
|---|---|
| `kind` | loi, jurisprudence, position d'un régulateur, publication officielle, avis juridique |
| `reference` | référence citable |
| `status` | `UNVERIFIED` · `VERIFIED` · `SUPERSEDED` |
| `verifiedAt` / `verifiedBy` | **obligatoires** pour qu'elle soutienne quoi que ce soit |

Une ligne marquée `VERIFIED` sans date ni auteur est une case cochée, pas une
vérification. Exiger les trois rend le raccourci impossible.

`SUPERSEDED` n'est pas `UNVERIFIED` : une source remplacée **a été** vérifiée, et
l'écraser effacerait la raison pour laquelle une décision passée avait été prise.
Elle cesse de soutenir une autorisation sans disparaître de l'historique.

### Le cas qui compte : l'autorisation qui s'effondre

Une catégorie marquée « autorisée » dont la preuve a été remplacée n'est ni
autorisée ni interdite : elle redevient **non tranchée**. Le dire ainsi permet de
rouvrir le dossier au lieu de le subir — et les produits concernés quittent le
rayon le jour où la source tombe, sans que personne n'ait eu à y toucher.

## Catégories, substances, analytes : trois formes différentes

| | Forme | Pourquoi |
|---|---|---|
| **Catégories** | liste d'autorisation | on ne vend que ce qui a été examiné |
| **Substances** | liste de refus | on ne peut pas énumérer tout ce qui est licite, on peut énumérer ce qui ne l'est pas |
| **Analytes** | restreint avec plafond / non restreint / non tranché | un plafond est une affirmation sur le droit : il exige une preuve |

Sur les analytes, trois refus de statuer distincts, parce qu'ils se corrigent
différemment : `NO_RULE` (jamais examiné), `RESTRICTION_UNSUPPORTED` (plafond que
personne ne peut sourcer), `NO_LIMIT_SET` (restriction déclarée sans chiffre).

Un taux **exactement égal** au plafond le respecte : « au plus 0,3 % » n'est pas
« moins de 0,3 % », et confondre les deux n'est pas la même règle.

## Le portail de mise en vente

Un produit franchit **une seule porte**, pas six. `evaluateListing()` rassemble
tout : état du vendeur, complétude du KYB, conformité, politique de catalogue,
disponibilité commerciale.

Ces règles ont des auteurs et des rythmes différents — le KYB bouge quand un
commerçant complète son dossier, la conformité quand un relecteur tranche, la
politique quand une source est publiée. Les éparpiller garantit qu'un jour l'une
sera oubliée sur un chemin. Il n'y a donc qu'un chemin.

Ordre des contrôles : **vendeur, produit, plateforme, commerce**. Un commerçant
dont le shop est suspendu doit lire cela avant de lire qu'il lui manque un prix.

Tous les motifs sont rendus ensemble, jamais le premier, et chacun porte un
détail exploitable — « un taux dépasse le plafond » n'aide personne si on ne dit
pas lequel ni de combien.

### Les seize motifs de refus

```
MERCHANT_NOT_ACTIVE · MERCHANT_KYB_INCOMPLETE
COMPLIANCE_NOT_APPROVED · COMPLIANCE_EXPIRED · SUBMISSION_INCOMPLETE
POLICY_STALE
CATEGORY_MISSING · CATEGORY_PROHIBITED · CATEGORY_UNDECIDED
COMPOSITION_NOT_DECLARED · SUBSTANCE_PROHIBITED
ANALYTE_NOT_DECLARED · ANALYTE_ABOVE_LIMIT · ANALYTE_UNDECIDED
NOT_LISTED · OUT_OF_STOCK · NO_PRICE
```

## Ce que l'audit adversarial a trouvé, et corrigé

Les 302 tests de la première version étaient verts. Ils décrivaient des
situations plausibles ; aucun ne cherchait à faire passer un produit qui ne
devait pas passer. Quatre portes étaient ouvertes.

### Déclarer moins pour être contrôlé moins

Le portail n'examinait que ce qui était **déclaré**. Un produit sans analyte
déclaré ne voyait aucun plafond appliqué ; une composition vide ne rencontrait
aucune liste de refus. Le contrôle se contournait en fournissant moins
d'information, pas plus.

Désormais : chaque analyte que la politique encadre doit être **mesuré**
(`ANALYTE_NOT_DECLARED`), et une composition vide est un refus
(`COMPOSITION_NOT_DECLARED`).

### `NaN` franchissait tous les plafonds

En JavaScript, `NaN > 0.3` vaut `false`. La comparaison seule renvoyait donc la
branche « conforme ». Un taux négatif y passait aussi, et un taux de 999 %
n'alertait personne — le certificat, lui, n'inspectait que la valeur `null`.

Désormais : toute mesure doit être finie, positive et ≤ 100. À défaut,
`INVALID_MEASUREMENT`, qui bloque.

### La liste de refus se contournait par l'orthographe

La normalisation était `trim().toLowerCase()`. La même fonction servait une
liste d'**autorisation** (échec ⇒ non tranché ⇒ bloque) et une liste de
**refus** (échec ⇒ **laisse passer**). Cette asymétrie de conséquence n'avait pas
été pensée : quatre écritures d'une même substance échappaient au contrôle, dont
une avec un tiret demi-cadratin et une avec un omicron grec — invisibles à l'œil.

Désormais : `normaliseSubstance()` décompose l'Unicode, replie les homoglyphes
grecs et cyrilliques, supprime tout ce qui n'est ni lettre ni chiffre. Les
substances portent des **alias** explicites, et l'appariement se fait par
occurrence dans le texte — une composition réelle est faite de phrases, pas de
jetons.

### Deux portes de plus, l'une plus faible que l'autre

`isOrderable()` et `evaluateProductAvailability()` restaient exportées à côté du
portail complet. La première ignorait l'état du vendeur, la catégorie, les
substances et les taux. Deux portes dont l'une est plus faible, c'est une porte.
Les deux ont été **supprimées**.

### Trois gardes qui existaient sans être branchées

`canActivate()` n'était appelée par aucune garde de transition : un admin pouvait
activer un shop au dossier vide. `checkComplianceSubmission()` n'était appelée
nulle part : un produit pouvait être `APPROVED` sans qu'aucun certificat n'ait
jamais été contrôlé. Et `decidedAt` n'était lu par personne : une politique
figée depuis des années était traitée comme celle d'aujourd'hui.

Les trois sont désormais dans le chemin : activation refusée sur dossier
incomplet, `SUBMISSION_INCOMPLETE` au portail, `POLICY_STALE` sur une politique
jamais revue ou dont la revue a trop vieilli.

### Une preuve datée de 2099 soutenait une autorisation

`supportsAuthorisation()` ne comparait jamais `verifiedAt` à l'horloge. Elle
reçoit maintenant la date du jour et refuse une vérification datée du futur ou
portant une date invalide.

## Ces correctifs sont-ils porteurs ?

Chaque correctif a été retiré séparément pour vérifier que les tests le
détectent. Résultats réels :

| Correctif retiré | Tests devenus rouges |
|---|---|
| Validation des mesures | 5 |
| Exigence de déclaration des analytes | 4 |
| Garde d'activation | 2 |
| Normalisation agressive | 1 |
| Appariement par occurrence | 1 |
| Validation du mode de libération | 2 |

## Le parcours, joué du début à la fin

Un test déroule la chaîne entière : candidature → dossier complété → validation
admin → dépôt de produit refusé sans COA → dépôt accepté avec COA → produit
bloqué tant que la conformité n'est pas approuvée → mise en vente.

Deux gardes y sont vérifiées explicitement : **un shop ne se valide pas
lui-même**, **un commerçant n'approuve pas sa propre conformité**.

Et surtout : le parcours n'est pas un état acquis. Chaque maillon retiré
séparément bloque, à tout moment — shop suspendu, dossier redevenu incomplet,
certificat expiré, preuve juridique remplacée. Si l'un d'eux passait, une porte
serait ouverte quelque part.

## La taxonomie produit

Liste **fermée** de dix catégories, comparées **exactement** — ni la casse ni les
tirets ne sont rattrapés. Tolérer « flower » masquerait une saisie libre là où
l'on attend une valeur produite par le système.

```
FLOWER · RESIN · OIL_NON_FOOD · COSMETIC · FOOD
SUPPLEMENT · VAPE · ACCESSORY · OTHER · PROHIBITED_DERIVATIVE
```

**Il n'existe pas de catégorie « CBD ».** Un produit au CBD peut être une fleur,
une huile, un aliment ou un cosmétique, et ces natures ne relèvent pas des mêmes
règles. Les confondre sous une étiquette unique effacerait précisément la
distinction que la conformité doit faire.

Deux catégories sont **fermées par construction** :

- `PROHIBITED_DERIVATIVE` — aucune politique ne peut l'ouvrir, même avec une
  preuve vérifiée. C'est le seul endroit où le code refuse d'obéir à sa
  politique, et c'est volontaire : cette catégorie existe pour nommer ce qui ne
  se distribue pas.
- `OTHER` — ce n'est pas une catégorie, c'est l'absence de classement. L'ouvrir
  reviendrait à autoriser tout ce que personne n'a su ranger.

Quatre refus distincts, parce qu'ils se corrigent de quatre façons :
`CATEGORY_UNKNOWN` (saisir une valeur de la taxonomie), `CATEGORY_UNCLASSIFIED`
(classer le produit), `CATEGORY_UNDECIDED` (obtenir une décision),
`CATEGORY_PROHIBITED` (renoncer).

### Ce que le code ne peut pas faire

Il vérifie qu'une **déclaration** est recevable. Il ne vérifie **pas** qu'elle
est vraie. Un produit déclaré `FLOWER` alors qu'il relève de
`PROHIBITED_DERIVATIVE` franchit toutes les portes de ce module. Cette limite est
structurelle, pas un défaut à corriger : rien dans une chaîne de caractères ne
dit la nature matérielle d'une marchandise. Elle se traite par le contrôle humain
et la preuve documentaire.

## Delta-9 et THC total ne se substituent pas

Le certificat porte **deux** mesures, et elles ne disent pas la même chose :

- `delta9ThcPercent` — la mesure sur laquelle un plafond peut porter ;
- `totalThcPercent` — informatif, il agrège des formes qui n'ont pas le même
  statut, et n'est confronté à aucun plafond par ce module.

Les confondre dans un sens refuserait des produits conformes ; dans l'autre, en
laisserait passer. Aucun seuil n'est écrit dans le code : les plafonds vivent
dans la politique, révisables et adossés à une preuve.

Le certificat exige aussi un **laboratoire émetteur** — sans lui, il n'y a
personne à recontacter en cas de doute — et une **date d'émission** ni absente,
ni illisible, ni future : une analyse ne peut pas avoir été faite demain.

## Cycle de vie du vendeur : six états, un seul vend

```
PENDING_VALIDATION → KYB_REVIEW → APPROVED → ACTIVE
                          ↑                     │
                          └──── CRITICAL_CHANGE ┘
```

`APPROVED` **ne vend pas**. Valider un dossier et ouvrir un commerce sont deux
décisions distinctes, prises à des moments différents et parfois par des
personnes différentes ; les fondre en une seule ferait qu'approuver un KYB
mettrait un shop en ligne — ce que personne ne veut au moment où il signe
l'approbation.

### Changement critique

Cinq champs, et ce ne sont pas « les champs importants » : ce sont ceux sur
lesquels l'approbation portait. `BENEFICIAL_OWNER`, `BANK_ACCOUNT`, `LEGAL_FORM`,
`REGISTRATION_NUMBER`, `LEGAL_NAME`.

Les modifier renvoie un shop `APPROVED`, `ACTIVE` ou `SUSPENDED` en `KYB_REVIEW`,
et il faut repasser par `APPROVED` puis `ACTIVE` pour revendre. Aucun raccourci.

La comparaison ignore la casse et les espaces superflus : relancer un examen KYB
sur une correction de frappe userait la procédure au point qu'on cesserait de la
respecter. Le compte bancaire n'est comparé que par empreinte — détecter un
changement n'exige pas de connaître la valeur.

## Dépendances entre analyses

Mécanisme générique, **sans aucun contenu juridique** : « si tel analyte est
mesuré au-dessus de tel seuil, alors tels autres deviennent obligatoires ». La
politique fournit les règles ; le code n'en connaît aucune.

Trois issues, et aucune n'est un silence : satisfaite, analyse manquante (refus),
ou dépendance que personne ne peut sourcer (refus également — une exigence non
sourçable ne doit ni bloquer ni s'effacer en silence).

## Garde anti-monétaire

Un test statique relit tout `src/` et cherche des **identifiants**, pas des mots :
les commentaires sont retirés avant analyse, pour qu'expliquer le gel reste
possible. Il détecte camelCase, snake_case, SCREAMING_CASE, noms isolés, chaînes
littérales et imports.

Les exceptions sont accordées **jeton par jeton**, pas fichier par fichier :
`order/status.ts` peut nommer `PENDING_PAYMENT` sans pouvoir gagner un
`addPayout()` en silence. Neuf exceptions, chacune justifiée par écrit.

Le garde a relevé un nom qui promettait ce que le système ne fait pas : l'étape
de tunnel `checkout_started`, renommée `order_review`. Il n'existe aucun tunnel
de paiement.

## Ce qui n'est pas fait

- **Persistance.** La politique, les preuves et les décisions ne sont pas encore
  en base. Le domaine est complet et testé ; il n'a pas d'adaptateur.
- **Services API et back-office** : saisir une politique, vérifier une preuve,
  valider un shop, approuver une conformité.
- **Expiration automatique.** Un certificat périmé est bloqué à l'évaluation, ce
  qui est la bonne garde ; le basculement du statut en `EXPIRED` par tâche de
  fond n'existe pas.

## Ce qui reste interdit

Ledger · wallet vendeur · moteur de payout · moteur de remboursement · checkout
réel · intégration PSP · comptabilité définitive.

O-001 reste NO-GO transactionnel.
