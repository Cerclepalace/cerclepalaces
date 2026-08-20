# Modèle économique

> **Statut : non arrêté.** Voir `TO_VERIFY.md`, décisions 04 à 09. Ce document
> décrit ce que le code sait faire, pas ce qui a été choisi.

## Ce qui n'est pas décidé

Le modèle de revenus (commission, frais de livraison, abonnement commerçant, ou
combinaison) et surtout **qui est le vendeur légal** — cette dernière décision
commande la facturation, la TVA, la responsabilité produit et le choix du PSP.

## Ce que le code permet

`packages/domain/src/pricing/breakdown.ts` calcule la répartition à partir d'une
`RevenueConfig`. Cinq modèles sont acceptés, aucun n'est appliqué par défaut :

```
commission_only · delivery_fee_only · commission_and_delivery
subscription_only · hybrid
```

Changer de modèle est un changement de configuration, pas une réécriture.

## La marge est un reste, pas une entrée

C'est le point important de ce module. La part plateforme se déduit une fois le
shop, le coursier et le PSP payés :

```
platformNet = customerTotal − merchantPayout − driverPayout − pspFee
```

Elle **peut être négative**, et le code ne le masque pas. Pendant le pilote,
c'est précisément l'information à voir : une commande peut être commercialement
séduisante et structurellement déficitaire.

## Exemple chiffré

Valeurs illustratives uniquement — commission et rémunération coursier ne sont
pas arrêtées.

Panier de 50 €, livraison 4,90 €, commission 15 %, coursier 4,50 €, PSP 1,40 % + 0,25 € :

| Poste | Montant |
|-------|---------|
| Produits | 50,00 € |
| Livraison | 4,90 € |
| **Payé par le client** | **54,90 €** |
| Reversé au shop | 42,50 € |
| Reversé au coursier | 4,50 € |
| Frais PSP | 1,02 € |
| **Reste plateforme** | **6,88 €** |

Sur ce jeu d'hypothèses, la marge tient. En abaissant le panier à 15 € avec une
livraison à 2,90 € et un coursier à 6 €, elle devient négative — le module le
calcule et un test le vérifie explicitement.

## Règles techniques

- **Tous les montants sont des entiers en centimes.** Aucun flottant ne circule
  sur de l'argent : `0.1 + 0.2 !== 0.3` n'est pas une abstraction quand il
  s'agit de reverser à un commerçant.
- `breakdownBalances()` vérifie que la somme des parts égale exactement ce que
  paie le client. Un écart d'un centime est un bug comptable, pas un arrondi
  acceptable. Un test le contrôle sur une large plage de montants.
- La répartition est **figée sur la commande** à la validation
  (`Order.merchantPayoutCents`, etc.). La recalculer plus tard donnerait un
  résultat différent si les prix ou la configuration ont changé depuis.

## À mesurer pendant le pilote (phase 6)

Nombre de scans · taux de conversion scan → commande · commandes par shop ·
panier moyen · coût réel de livraison · rémunération coursier · marge plateforme
par commande · délai moyen · taux d'annulation · taux de réachat.

L'expansion (phase 7) ne se déclenche que si ces chiffres tiennent.
