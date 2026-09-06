# Conformité produit

> **Aucune règle juridique n'est inventée dans ce projet.** Les seuils
> réglementaires applicables sont à confirmer auprès de sources officielles —
> `TO_VERIFY.md`, décision 10. Ce document décrit l'architecture qui les
> accueillera, pas leur contenu.

## Le principe

La conformité est **indépendante du commerce**. Un produit peut être en stock,
correctement prixé et listé par le commerçant tout en étant interdit à la vente.
Ces deux dimensions ne se mélangent jamais dans le code.

## Machine à états

```
PENDING_REVIEW ──→ APPROVED ──→ SUSPENDED ──→ APPROVED
      │                │            └──────→ REJECTED
      └──→ REJECTED    └──→ EXPIRED ──→ PENDING_REVIEW
             └──→ PENDING_REVIEW (dossier corrigé)
```

- La validation (`PENDING_REVIEW → APPROVED`) est réservée à l'**admin**. Un
  commerçant ne peut jamais approuver ses propres produits, ni lever une
  suspension.
- Le commerçant peut resoumettre un dossier refusé ou expiré.
- Le système peut faire expirer un certificat dont la date de validité est
  dépassée.

## La règle non négociable

```ts
isSellable(status) === (status === "APPROVED")
```

Un produit non approuvé n'est jamais commandable, **quel que soit son stock**.

Toute liste de produits commandables passe par une seule fonction :

```ts
isOrderable({ compliance, stock, listedByMerchant })
```

Ne jamais dupliquer ce test ailleurs sous une autre forme — c'est par là que les
régressions de conformité arrivent.

## Données enregistrées

`ProductCompliance` conserve : catégorie, composition, taux THC, taux CBD,
fournisseur, numéro de lot, date de vérification, vérificateur, date
d'expiration, notes de revue. Les documents justificatifs (certificats
d'analyse, fiches fournisseur) sont rattachés via `ComplianceDocument`.

Les taux sont stockés **tels que déclarés et certifiés**. Aucun seuil n'est codé
en dur : quand les valeurs applicables seront confirmées, elles deviendront des
paramètres vérifiables, pas des constantes dispersées dans le code.

## Accès

Les documents de conformité sont accessibles à l'**admin uniquement**. Ils ne
sont jamais exposés côté client ni côté coursier.

## Point non traité

La **vérification d'âge** à la commande ou à la livraison n'est pas implémentée
et n'était pas au cadrage initial — `TO_VERIFY.md`, décision 11. À trancher
avant le pilote.
