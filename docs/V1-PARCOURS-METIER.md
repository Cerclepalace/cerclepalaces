# V1 non financière — le parcours métier

> Ce document décrit ce qui est **construit**, pas ce qui est prévu. Ce qui reste
> à faire est nommé comme tel à la fin.

## La règle qui gouverne cette phase

Il n'y a ni PSP, ni encaissement, ni versement, ni marketplace publique. Le
parcours va du vendeur à la commande, et s'arrête avant l'argent.

Ce n'est pas une restriction subie : c'est la conséquence de décisions non
prises. Qui est le vendeur légal (décision 05) et quel PSP encaisse (décision 09)
commandent la forme du paiement. Construire un encaissement avant ces réponses
reviendrait à les donner en silence.

## Le mode de traitement — la pièce centrale

`PENDING_PAYMENT` et `PAID` affirment quelque chose sur de l'argent. Faire passer
une commande non payée par ces états produirait une base qui ment : des commandes
marquées « paiement confirmé » sans qu'un euro ait bougé, indiscernables des
vraies le jour où il y en aura.

D'où un **mode de traitement**, porté par la commande :

| Mode | Entrée du parcours | États de paiement |
|---|---|---|
| `PAYMENT_REQUIRED` | `CART → PENDING_PAYMENT → PAID → ACCEPTED` | atteignables |
| `SIMULATED` | `CART → ACCEPTED` | **inatteignables** |

La table des transitions porte la restriction. Ce n'est donc pas une convention
qu'on peut oublier : `PAID` n'existe pas pour une commande simulée, et le
raccourci `CART → ACCEPTED` n'existe pas pour une commande payante. Une tentative
ne renvoie pas « transition inconnue » mais `MODE_NOT_ALLOWED`, avec la raison —
sinon on cherche une transition manquante qui existe.

Le mode par défaut, quand un appelant l'oublie, est `PAYMENT_REQUIRED` : l'oubli
ferme le raccourci — un échec visible — plutôt que d'ouvrir sans le savoir un
chemin vers `PAID`.

Parcours simulé complet, calculé depuis la table et non recopié :

```
CART → ACCEPTED → PREPARING → READY_FOR_PICKUP
     → DRIVER_ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
```

À partir de `ACCEPTED`, les deux modes suivent exactement le même chemin : le
mode ne concerne que l'entrée. La question du remboursement, elle, ne se pose
jamais sur une commande simulée — rien n'a été encaissé.

## Le vendeur : validation avant vente

Quatre états, sept transitions, **aucune automatique**. Suspendre un commerçant
ou le rouvrir sont des actes qui doivent avoir un auteur identifiable.

```
PENDING_VALIDATION ──admin──> ACTIVE ──plateforme──> SUSPENDED ──admin──> ACTIVE
        │                        │                       │
        └──────────────> CLOSED <┴───────────────────────┘
                            │
                            └──admin──> PENDING_VALIDATION
```

Deux choix à connaître :

- **Un shop ne peut pas se valider lui-même.** La seule sortie de
  `PENDING_VALIDATION` ouverte au commerçant est `CLOSED` — l'abandon de sa
  candidature. Sans cela, le KYB ne servirait à rien.
- **`SUSPENDED` n'est pas terminal.** Une suspension sans retour serait une
  fermeture déguisée, donc une mesure qu'on n'oserait jamais prendre — et donc
  inutilisable.

### Complétude du dossier

`checkKybDossier()` rend **tous** les manques d'un coup, jamais le premier : un
commerçant qui corrige pièce par pièce, avec un aller-retour à chaque fois,
abandonne.

Ce qui est vérifié est la complétude **structurelle** — les champs que le modèle
prévoit sont remplis. **Aucune exigence réglementaire n'est codée.** La liste
officielle dépend du PSP et de l'acquéreur (décision 09) ; elle s'ajoutera
par-dessus, elle ne remplacera pas celle-ci.

## Le produit : conformité avant catalogue

### Déposer un dossier

`checkComplianceSubmission()` vérifie qu'un dossier est **déposable**, pas qu'il
est conforme — la conformité est jugée par un humain. Ce qu'il empêche, c'est
qu'un dossier vide arrive sur le bureau du relecteur : sans certificat d'analyse,
sans numéro de lot et sans taux déclarés, il n'y a rien à vérifier, et le refus
qui suivra aura coûté un aller-retour à tout le monde.

L'exigence d'un COA est une **règle de la plateforme**, pas une affirmation
réglementaire : nous refusons de faire circuler un produit dont personne n'a
analysé le contenu. Ce qu'un COA doit contenir légalement reste à confirmer
(décision 10).

Un taux de `0` est une valeur déclarée, pas une absence — le confondre avec
`null` refuserait un produit sans THC, exactement l'inverse du but.

### Mettre un produit en vente

Trois conditions indépendantes, qui échouent séparément :

1. le shop a le droit de vendre ;
2. le produit est conforme ;
3. le shop l'a listé, en a en stock, et lui a mis un prix.

`evaluateProductAvailability()` rend **tous** les blocages, parce qu'un
commerçant qui ne voit pas son produit doit savoir lequel des trois lui manque.

Un cas mérite d'être signalé : un **certificat périmé sur un produit encore
marqué `APPROVED`** est le plus dangereux du lot, parce qu'il ressemble à un
produit conforme. Il est bloqué sans attendre qu'une tâche de fond ait basculé le
statut — une garde qui dépend d'un cron n'est pas une garde.

## Où en est la construction

| Étape | Domaine | Persistance | API |
|---|---|---|---|
| Vendeur, KYB, validation | ✅ | — | — |
| Catalogue, produit, COA | ✅ | — | — |
| Commande simulée (mode) | ✅ | — | — |

Le domaine est écrit et testé ; rien n'est encore branché sur la base.

### Ce qui manque, nommément

- **`Order.fulfilmentMode` en base.** Le mode est une propriété de la commande :
  sans colonne, le service ne peut pas savoir quelle machine à états appliquer.
  C'est une migration à venir. Elle n'ajoute aucun modèle transactionnel — c'est
  une énumération à deux valeurs qui marque l'*absence* de paiement.
- Les services API : validation d'un shop, dépôt et validation d'un dossier de
  conformité, mise en vente, création d'une commande simulée.
- Les adaptateurs Prisma correspondants, et leur passage au garde-fou de portée
  tenant.
- Les tests d'intégration PostgreSQL du parcours complet.

### Ce qui reste interdit à ce stade

Paiement réel · PSP en production · encaissement · versement réel · lancement
transactionnel.
