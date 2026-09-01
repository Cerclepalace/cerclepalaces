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

### Les treize motifs de refus

```
MERCHANT_NOT_ACTIVE · MERCHANT_KYB_INCOMPLETE
COMPLIANCE_NOT_APPROVED · COMPLIANCE_EXPIRED
CATEGORY_MISSING · CATEGORY_PROHIBITED · CATEGORY_UNDECIDED
SUBSTANCE_PROHIBITED · ANALYTE_ABOVE_LIMIT · ANALYTE_UNDECIDED
NOT_LISTED · OUT_OF_STOCK · NO_PRICE
```

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
