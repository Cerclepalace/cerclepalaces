# Réseau de livraison — architecture V1

> Noyau métier du réseau de livraison Projet 1. Aucun paiement réel, aucun
> transporteur externe branché, aucune hypothèse juridique transformée en
> décision technique.

## Le produit cible

```
SHOP → ORDER → DELIVERY → DISPATCH ENGINE → DRIVER
     → PICKUP → DELIVERY → PROOF OF DELIVERY → REPEAT ORDER
```

## Le driver n'est pas exclusif

C'est le postulat qui explique la moitié des choix de ce document.

Un driver Projet 1 travaille peut-être en parallèle sur Uber Eats ou Deliveroo.
Il en découle trois règles tenues partout dans le code :

- `ONLINE` signifie **« j'accepte de recevoir des propositions »**, jamais
  « je dois accepter une course » ;
- refuser, laisser expirer ou repasser hors ligne sont des comportements
  normaux, pas des fautes ;
- **aucune pénalité automatique** n'existe. Pas de score de refus, pas de mise à
  l'écart après N non-réponses. Le moteur n'a pas de mémoire punitive.

Conséquence de modèle : `Driver` n'a **pas** de `merchantId`. C'est un acteur du
réseau logistique, pas la propriété d'un shop. Il peut recevoir des offres de
plusieurs merchants.

## Vocabulaire

`Driver` est le terme technique unique : domaine, schéma, API, tests.
« Coursier » n'existe qu'en libellé français destiné à l'interface. Aucun
concept métier `Courier` ne subsiste — le renommage a été complet, y compris
`OrderStatus.DRIVER_ASSIGNED` et `Order.driverPayoutCents`.

## Machine d'état de la livraison

```
PENDING_DISPATCH ──→ OFFERING ──→ ASSIGNED ──→ PICKED_UP ──→ IN_TRANSIT ──→ DELIVERED
       │                 │            │             │              │
       │                 ├─→ UNASSIGNED ←───────────┘              │
       │                 │      │                                  │
       └─→ CANCELLED ←───┴──────┘                                  │
                         └─────────────→ FAILED ←──────────────────┘
```

Terminaux : `DELIVERED`, `FAILED`, `CANCELLED`. `UNASSIGNED` ne l'est
délibérément pas — une course rendue doit pouvoir repartir au dispatch.

`assertDeliveryTransition(from, to, actor)` est **pure** : aucune horloge,
aucune base, aucun effet. Elle répond à une seule question — cette transition
est-elle permise à cet acteur.

### Deux transitions ajoutées à la spécification initiale

Signalées explicitement parce qu'elles n'étaient pas demandées :

| Transition | Pourquoi |
|---|---|
| `PENDING_DISPATCH → CANCELLED` | Sans elle, une commande annulée avant le premier tour laisse une livraison bloquée à vie |
| `ASSIGNED → UNASSIGNED` | Un driver peut se désister après avoir accepté (panne, imprévu). Sans cette sortie, la course reste assignée à quelqu'un qui ne viendra pas |

## Propositions

`DeliveryAssignment` est une **proposition**, pas une affectation. Statuts :
`OFFERED · ACCEPTED · REJECTED · EXPIRED · CANCELLED`.

Deux règles :

1. **Une seule `ACCEPTED` par livraison.** Garantie à trois niveaux : la
   vérification métier en amont, l'index unique partiel en base
   (`uniq_delivery_accepted_assignment`, créé à la main dans la migration car
   Prisma ne l'exprime pas), et surtout le **verrou optimiste** sur
   `Delivery.version` — c'est lui qui tranche réellement une égalité parfaite.
2. **L'historique est conservé**, y compris après réassignation. C'est ce qui
   permet de répondre à « pourquoi cette course a-t-elle mis vingt minutes à
   trouver preneur ».

## Moteur de dispatch

Contrat non négociable : le moteur **n'appelle rien**. Pas de base, pas d'API,
pas de `Date.now()`, pas de génération d'identifiants, pas de notification.

```
nextOffer(state, now) → DispatchDecision
```

> même `state` + même `now` = même résultat, toujours.

Quatre fonctions : `selectCandidates`, `planOffers`, `nextOffer`,
`shouldReassign`.

### Sélection V1

Explicite, dans cet ordre — le premier motif qui s'applique est celui qui est
journalisé :

1. driver approuvé ;
2. `ONLINE` ;
3. zone compatible ;
4. catégorie de livraison supportée ;
5. sous la charge maximale ;
6. pas déjà sollicité sur cette course ;
7. distance acceptable ;
8. tri **déterministe** : distance, puis charge, puis identifiant.

Le dernier critère n'a aucun sens métier — il existe pour que l'ordre soit
total, donc reproductible.

Pas d'IA. Pas de machine learning. Pas de scoring mystérieux.

### Timeout

`offerTimeoutSeconds` est un paramètre de `DispatchPolicy`, jamais une constante
enfouie. Défaut : 30 s. À l'expiration, `OFFERED → EXPIRED`, puis le tour
suivant s'ouvre sur un autre driver.

### Auditabilité

`DispatchRound` représente une tentative, `DispatchDecision` une décision
individuelle. Chaque décision retient `driverId`, `decision`, `reason`, `rank`,
`distanceMeters`, `estimatedPickupSeconds`.

Les candidats **écartés** sont enregistrés au même titre que les retenus. Motifs
disponibles :

```
DRIVER_OFFLINE · DRIVER_NOT_APPROVED · OUTSIDE_ZONE · ALREADY_ASSIGNED
ALREADY_OFFERED · TOO_FAR · CATEGORY_NOT_SUPPORTED · AT_CAPACITY
NOT_SELECTED_THIS_ROUND · OFFER_CREATED · OFFER_EXPIRED
DRIVER_REJECTED · DRIVER_ACCEPTED
```

## Zones

Zone **logique** en V1 : un identifiant partagé entre un point de vente et les
drivers qui acceptent d'y travailler. `DriverZone` permet à un driver de couvrir
plusieurs zones — condition d'un réseau partagé entre shops.

Aucune géométrie, aucun calcul géospatial. La latitude/longitude existe déjà sur
`MerchantLocation`, `Address` et `Driver` : le jour où la zone logique ne suffit
plus, le moteur peut passer à un rayon réel sans changer le modèle de données.

## Multi-tenancy

**Décision : `merchantId` + repository scopé. Pas de Row-Level Security en V1.**

Le repository est la frontière de tenant. Pour que ce ne soit pas une convention
documentaire, trois choix :

1. `TenantScope` est un **type nominal**. Un `{ merchantId }` littéral ou une
   chaîne ne compile pas à sa place. Seul `tenantScope()` en fabrique un.
2. Le scope est toujours le **premier paramètre**, jamais optionnel, jamais avec
   valeur par défaut.
3. L'accès inter-tenant existe mais s'appelle `findForAdmin(scope: AdminScope, …)`.
   Un `TenantScope` ne peut pas l'atteindre, et un `AdminScope` ne peut pas
   remplacer un `TenantScope`. **Aucun rôle ne contourne implicitement le scope**,
   admin compris.

### Tables portant `merchantId`

| Table | Justification |
|---|---|
| `Order` | Isolation directe + index `[merchantId, status]` et `[merchantId, createdAt]` |
| `Inventory` | Le pivot commercial ; index `[merchantId, isListed]` |
| `Cart` | Isolation + purge des paniers par shop |
| `Delivery` | Isolation + index `[merchantId, status]` pour le tableau de bord shop |
| `QrCode` | Isolation + listing par shop |
| `QrScanEvent` | Volume élevé, requêtes de tunnel systématiquement par shop |
| `DispatchRound` | Le shop doit pouvoir consulter ses propres tours |

### Tables volontairement sans `merchantId`

| Table | Pourquoi |
|---|---|
| `Driver`, `DriverZone`, `DriverAvailabilityLog` | Acteur du réseau, pas propriété d'un shop |
| `Product` | Référence de catalogue, voir ci-dessous |
| `DeliveryAssignment` | Toujours atteinte via `Delivery`, qui est scopée |
| `DispatchDecision` | Toujours atteinte via `DispatchRound`, qui est scopée |
| `ProofOfDelivery`, `DriverPayout` | Atteintes via `Delivery` |
| `OrderStatusEvent`, `DeliveryStatusEvent` | Atteints via leur agrégat |
| `Zone` | Référentiel partagé |

### Product vs Inventory — décision documentée

L'invariant existant est conservé : **`Inventory` est le pivot du catalogue**.

`Product.merchantId` reste **optionnel**, et c'est délibéré :

- `null` → produit du référentiel partagé, vérifié une fois par la plateforme et
  réutilisable par plusieurs shops ;
- défini → produit propre à un shop.

Ce n'est pas une brèche : rien de commercialement sensible ne vit sur `Product`.
Le prix, le stock et la mise en vente sont dans `Inventory`, qui est tenanté et
porte `merchantId`. Un produit visible ne veut pas dire vendable — seul
`isOrderable()` en décide, et il exige `APPROVED` **et** stock **et** mise en
vente par le shop.

`Delivery` est tenantée par son merchant, jamais déduite du driver :
`assignedDriverId ≠ propriété`. Un driver assigné des deux côtés de deux shops
ne peut pas s'en servir pour franchir la frontière — l'accès passe toujours par
`DeliveryRepository`, scopé.

## Preuve de remise

`ProofOfDelivery` accepte `PHOTO`, `SIGNATURE`, `CODE`. Le domaine ne manipule
jamais de fichier : il conserve un `storageKey`, et pour un code une empreinte
(`codeHash`) — **jamais le code en clair**, sinon une fuite de la base
permettrait de fabriquer des preuves de livraison.

`DEFAULT_PROOF_POLICY` n'exige **rien**. Imposer un mécanisme avant d'avoir
tranché la vérification d'âge (décision 11) transformerait une hypothèse
juridique en contrainte technique.

## Rémunération

`calculateDriverPayout()` est pure et déterministe, décomposée poste par poste :
base, distance, attente, prime, complément de plancher.

Aucun tarif n'est codé en dur — tout arrive par `PayoutRates`.
`calculationVersion` est enregistrée avec chaque payout : faire évoluer la
formule n'invalide pas l'historique.

**Aucun versement réel n'est effectué.** Ce module calcule, il ne paie pas.

### Marge plateforme

L'invariant existant tient : la marge est un **reste**, jamais une entrée.

```
revenue − PSP − coût de livraison − payout driver − remboursements = marge
```

Elle peut être négative, et le code ne le masque pas.

## Ports providers

`PaymentProvider` et `DeliveryProvider` sont des **interfaces seules**.
`NoopPaymentProvider` et `NoopDeliveryProvider` **refusent explicitement** toute
opération, avec une erreur typée.

Ce ne sont pas des bouchons de test qui feraient semblant de réussir : un faux
succès de paiement laisserait une commande passer en `PAID` sans qu'aucun euro
n'ait bougé ; un faux succès de livraison laisserait croire qu'un transporteur
viendra chercher le colis.

Ce qui n'est **délibérément pas** dans `PaymentProvider`, et n'y entrera pas
sans décision explicite : split payment, comptes connectés, reversements
multi-parties. Les modéliser trancherait la décision 05 en silence.

## Concurrence

Trois gardes empilées, aucune ne remplaçant les autres :

| Garde | Contre quoi |
|---|---|
| `TenantScope` | lecture ou écriture hors du shop |
| `assertDeliveryTransition` | transition illégale ou acteur non autorisé |
| `Delivery.version` | écriture concurrente silencieuse |

Le verrou est un **compare-and-set évalué au moment de l'écriture** contre
l'état partagé, jamais contre une valeur lue plus tôt — l'équivalent de :

```ts
updateMany({ where: { id, merchantId, version }, data: { ..., version: { increment: 1 } } })
```

Une transition acceptée écrit **statut + événement + audit dans la même
transaction**. Si l'une échoue, aucune ne s'applique : la trace n'est pas un
effet de bord qu'on pourrait oublier.

### Idempotence

Rejouer la même transition ne produit pas de second événement. Protège les
retries HTTP, les webhooks de PSP livrés plusieurs fois par conception, et les
jobs de worker dupliqués (BullMQ, SQS).

### Tests de course

`apps/api/src/deliveries/concurrency.test.ts` couvre les scénarios 1 à 8 et 10.

Ils ouvrent de **vraies** fenêtres de concurrence grâce à
`concurrency.harness.ts` : une barrière fait partir toutes les tâches ensemble,
et un point d'interleaving suspend chaque écriture après que toutes ont lu.
Sans ces deux mécanismes, Node exécuterait les tâches l'une après l'autre et
les tests passeraient sur du code cassé.

Vérifié par mutation : en désactivant le verrou optimiste, **9 des 17 tests
tombent**. Les 8 qui subsistent portent sur l'isolation tenant et
l'immuabilité des états terminaux, qui ne dépendent pas du verrou.

Le scénario 9 (crash de la base en milieu de transaction) exige un PostgreSQL
réel qu'on interrompt : c'est un test d'intégration, hors de cette suite. Ce
qui est vérifié ici, en revanche, c'est qu'une transaction échouée n'annule
**que ses propres écritures**, jamais celles des transactions voisines.

### Rejeu du journal

`replayDeliveryEvents()` reconstruit l'état depuis le journal et détecte trois
incohérences, chacune signalant un bug réel :

- **GAP** — un changement d'état n'a pas laissé de trace ;
- **ILLEGAL_TRANSITION** — une transition absente de la table a été écrite ;
- **AFTER_TERMINAL** — un événement suit un état terminal.

`eventsMatchStoredStatus()` est à passer en contrôle périodique : une
divergence entre le statut stocké et le journal signifie qu'un chemin
d'écriture contourne le service. C'est un incident, pas une donnée à corriger
discrètement.

## Deux machines, pas une

Une spécification ultérieure proposait de fusionner les états de proposition
(`OFFERED`, `ACCEPTED`, `DECLINED`, `EXPIRED`) dans la machine de livraison.
Ce choix a été **écarté**, pour une raison précise : avec `DECLINED` et
`EXPIRED` terminaux sur la livraison, un seul refus de driver tuerait la
course définitivement, et la réassignation deviendrait impossible.

Le refus et l'expiration appartiennent à la **proposition**, pas à la course :

| Machine unique (écartée) | Deux machines (retenu) |
|---|---|
| `Delivery.OFFERED` | `Delivery.OFFERING` |
| `Delivery.ACCEPTED` | `Delivery.ASSIGNED` |
| `Delivery.DECLINED` terminal | `Assignment.REJECTED` → la course continue |
| `Delivery.EXPIRED` terminal | `Assignment.EXPIRED` → tour suivant |
| — | `Delivery.UNASSIGNED` → repart au dispatch |

## Limites V1 assumées

- Distance à vol d'oiseau (haversine), pas de distance routière.
- Zone logique, pas de géométrie.
- Pas de batching, pas de regroupement de courses.
- `parallelOffers: 1` par défaut — dispatch strictement séquentiel.
- Pas de notifications push : le contrat API existe, le transport viendra.
- Pas de Row-Level Security.
- Pas de microservices, Kafka, event sourcing complet ni CQRS.

Ces limites sont des choix, pas des oublis. L'architecture les lève sans refonte
quand le volume les justifiera.

## Hors scope, explicitement

Paiement réel · split payment · marketplace publique · flotte de coursiers
propriétaire · intégration Uber Direct, Stuart ou Deliveroo · interface driver
finalisée (seul le contrat API existe).
