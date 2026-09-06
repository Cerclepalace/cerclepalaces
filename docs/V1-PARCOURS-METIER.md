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

## `Order.fulfillmentMode` — la pièce centrale

### La question à laquelle il répond

Une seule, lisible dans la table des transitions : **qui débloque la commande
pour que le shop puisse la préparer ?**

| Valeur | Entrée du parcours | Qui libère | États de paiement |
|---|---|---|---|
| `EXTERNAL_CONFIRMATION` | `CART → PENDING_PAYMENT → PAID → ACCEPTED` | une confirmation venue de l'extérieur, portée par l'acteur `system` | atteignables |
| `MERCHANT_DIRECT` | `CART → ACCEPTED` | le shop lui-même | **inatteignables** |

### Pourquoi ces noms

Deux pièges évités, et ils comptent.

**Nommer un mode d'après le paiement** trancherait ce que ce projet refuse
justement de trancher : qui encaisse, qui est vendeur légal (décisions 05 et 09).
Le mode dit qu'une confirmation extérieure est attendue ; il ne dit ni de qui, ni
de quoi. Les statuts `PENDING_PAYMENT` et `PAID` portent cette sémantique — c'est
leur rôle, pas celui du mode. Le jour où le PSP sera choisi, aucune valeur d'enum
ne sera à renommer.

**« Simulé » serait faux.** Une commande `MERCHANT_DIRECT` est réelle : le shop
prépare vraiment, un driver livre vraiment, un client reçoit vraiment. Seule la
jambe monétaire est absente. Étiqueter ces lignes « simulation » en base mentirait
sur des données d'exploitation authentiques, et ce mensonge survivrait à la V1.

### Ce que le code démontre

`EXTERNAL_CONFIRMATION` décrit exactement le workflow déjà implémenté :

- `PENDING_PAYMENT → PAID` est réservé à l'acteur `system`, jamais à une requête
  entrante ;
- la garde d'idempotence du service existe précisément pour ce workflow — son
  commentaire dit « un webhook est livré plusieurs fois par conception » ;
- le parcours testé de bout en bout part de `PENDING_PAYMENT` et attend cette
  confirmation avant que le shop n'agisse.

`MERCHANT_DIRECT` décrit l'autre : personne hors de la plateforme n'est consulté,
le shop accepte ou refuse.

### Aucune valeur par défaut, délibérément

La colonne est `NOT NULL` **sans défaut**. Un défaut choisirait à la place de
l'appelant, et le mauvais défaut est silencieux dans les deux sens : vers
`MERCHANT_DIRECT`, une commande à confirmer contournerait sa confirmation ; vers
`EXTERNAL_CONFIRMATION`, une commande du pilote resterait bloquée en panier.
Obliger à choisir supprime les deux.

Ce choix se vérifie : la migration posée, le typecheck a immédiatement refusé la
seule création de commande du dépôt qui ne disait pas son flux. Et PostgreSQL a
le dernier mot — un `INSERT` brut sans la colonne échoue en `23502`.

### Le mode est lu, jamais fourni

`transitionOrder` lit `order.fulfillmentMode` sur la commande. `TransitionCommand`
ne porte aucun champ de mode : une requête ne peut pas déclarer relever d'un autre
flux pour contourner la confirmation attendue.

Le défaut du domaine, quand un appelant oublie le paramètre, est
`EXTERNAL_CONFIRMATION` : l'oubli ferme le passage direct — un échec visible —
plutôt que de contourner la confirmation sans le savoir.

### Le parcours direct

Calculé depuis la table, jamais recopié :

```
CART → ACCEPTED → PREPARING → READY_FOR_PICKUP
     → DRIVER_ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
```

À partir de `ACCEPTED`, les deux flux suivent exactement le même chemin : le mode
ne concerne que l'entrée. La question du remboursement ne se pose jamais en flux
direct — le parcours ne traverse aucun état de paiement, donc rien n'a pu être
encaissé.

### État réel

`EXTERNAL_CONFIRMATION` est **déclaré mais inatteignable** aujourd'hui :
`NoopPaymentProvider` refuse toute opération, donc aucune confirmation ne peut
arriver. La valeur existe parce que la machine à états connaît déjà ce workflow,
pas parce qu'un flux l'emprunte.

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

| Étape | Domaine | Persistance | Service |
|---|---|---|---|
| Vendeur, KYB, validation | ✅ | — | — |
| Catalogue, produit, COA | ✅ | — | — |
| Mode de libération | ✅ | ✅ | ✅ |

### Ce qui manque, nommément

- Les services API : validation d'un shop, dépôt et validation d'un dossier de
  conformité, mise en vente, création d'une commande en flux direct.
- Les adaptateurs Prisma correspondants, et leur passage au garde-fou de portée
  tenant.
- Les tests d'intégration PostgreSQL du parcours complet.

### Ce qui reste interdit à ce stade

Paiement réel · PSP en production · encaissement · versement réel · lancement
transactionnel.
