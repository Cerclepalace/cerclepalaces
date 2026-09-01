# Intégration PostgreSQL — ce que la base a confirmé, et ce qu'elle a contredit

> Phase P1. Base réelle : PostgreSQL 16.13, installée par paquet système
> (`apt-get install postgresql`) après que Docker Hub s'est révélé inatteignable
> depuis cet environnement — le proxy de sortie renvoie 403 sur
> `production.cloudfront.docker.com`. Testcontainers n'était donc pas jouable ;
> la garantie recherchée — « une vraie base, pas un simulacre » — l'est.

## Pourquoi cette phase existe

Les suites en mémoire prouvent que **les règles** sont justes. Elles ne prouvent
rien sur les adaptateurs Prisma, qui n'avaient jamais été exécutés contre une
base au moment de leur écriture. Deux choses seulement sont vérifiables ici :

1. les adaptateurs se comportent comme le faux ;
2. la base tient les garanties que le service suppose — atomicité, verrou
   optimiste, rollback, étanchéité entre tenants.

## État constaté de la base

| Objet | Compte |
|---|---|
| Tables | 37 |
| Clés étrangères | 59 |
| Index uniques | 58 |
| Index (total) | 110 |
| Énumérations | 12 |

Schéma appliqué par `prisma db push` sur une base jetable. **Aucun fichier de
migration n'a été écrit** : la décision de portée (voir `TO_VERIFY.md`) n'est pas
tranchée, et générer la migration reviendrait à la trancher en silence.

## L'index que Prisma ne sait pas écrire

```sql
CREATE UNIQUE INDEX "uniq_delivery_accepted_assignment"
  ON "DeliveryAssignment" ("deliveryId")
  WHERE "status" = 'ACCEPTED';
```

Conservé dans `packages/db/prisma/sql/001_uniq_delivery_accepted_assignment.sql`,
à reprendre dans la première migration. Le langage de schéma de Prisma n'a pas de
clause `WHERE` sur un index ; sans écriture manuelle, la contrainte n'existe
nulle part.

Vérifié en contournant complètement l'application, en SQL brut :

```
INSERT 0 1
ERROR:  duplicate key value violates unique constraint "uniq_delivery_accepted_assignment"
DETAIL:  Key ("deliveryId")=(dlv_a) already exists.
```

Et vérifié comme *partiel* : quatre propositions non acceptées (2 REJECTED,
2 EXPIRED) sur la même livraison passent sans broncher (`INSERT 0 4`). Un unique
nu sur `deliveryId` aurait passé le premier test tout en cassant le dispatch.

## P1-01 — la divergence

**Fait.** Le cycle « A accepte, A se désiste, B accepte » échouait contre la
vraie base : `Unique constraint failed on the fields: (deliveryId)`. Il passait
en mémoire.

**Cause.** Le modèle traitait la proposition acceptée de A comme un fait
d'archive, laissé `ACCEPTED` pour toujours. L'index partiel, lui, n'admet qu'une
acceptation par livraison. Les deux règles sont défendables ; ensemble, elles
rendaient toute réassignation impossible. Le correctif C2 (« l'historique n'est
pas la propriété courante ») avait résolu le problème côté lecture, sans voir
qu'il en créait un côté écriture.

**Correction.** Rendre une course (`UNASSIGNED`, `CANCELLED`, `FAILED`) clôt
désormais **toutes les propositions vivantes** — celles encore `OFFERED` et
celle qui était `ACCEPTED`. Clore n'est pas effacer : `acceptedAt` reste
renseigné. Une proposition `CANCELLED` portant un `acceptedAt` se lit pour ce
qu'elle est — « ce driver avait accepté, puis la course lui a été retirée ».

L'invariant tient parce qu'un seul chemin ramène vers `OFFERING` : la table de
transitions ne laisse sortir `ASSIGNED` que vers `PICKED_UP`, `UNASSIGNED`,
`CANCELLED` ou `FAILED`, et seul `UNASSIGNED` peut repartir en `OFFERING`. Toute
reprise passe donc par une clôture.

**Effet de bord corrigé au passage.** `respondedAt` était écrasé par une date
sentinelle (`new Date(0)`) lors d'une invalidation. Sur une proposition
acceptée, cela aurait détruit un horodatage réel. Le champ est devenu optionnel :
une clôture décidée par la plateforme n'est pas une réponse de driver et
n'invente pas d'horodatage.

**Le faux dépôt reproduit désormais l'index.** Sans cela, la suite en mémoire
resterait verte là où la base rejette l'écriture — exactement la situation qui a
laissé passer P1-01.

## Scénarios rejoués contre la vraie base

| Scénario | Résultat |
|---|---|
| Deux drivers acceptent simultanément | Un seul gagne, `version = 1`, une seule proposition ACCEPTED, un seul événement d'historique |
| Deux tours de dispatch concurrents | Le perdant lève `DeliveryConflictError`, et son rollback emporte propositions *et* tour de dispatch déjà écrits |
| A accepte / A se désiste / B accepte | Réassignation effective, historique de A conservé |
| Libération du driver | `assignedDriverId` remis à `null`, offres ouvertes annulées |
| Transition illégale | Aucune écriture : statut, version et historique inchangés |
| Idempotence | Rejouer la même transition n'écrit pas un second événement |
| Étanchéité entre tenants | Un shop ne voit ni ne modifie la livraison d'un autre ; répondre à la proposition d'un autre shop renvoie `NOT_FOUND` |
| Contrainte de base contournée | PostgreSQL refuse, SQLSTATE 23505 |

Le test du rollback est celui qui apprend le plus : le worker perdant avait déjà
écrit ses propositions et son tour de dispatch **avant** de heurter le verrou
optimiste. La transaction les emporte. C'est ce que le service supposait ; c'est
maintenant vérifié.

## Deux barrières, pas une

`DispatchRound` porte `@@unique([deliveryId, roundNumber])`. Deux workers ouvrant
le *même* numéro de tour se heurtent donc à la base avant même d'atteindre le
verrou optimiste. Le test d'intégration donne délibérément des numéros de tour
différents aux deux workers, pour isoler la garde applicative — sans quoi il
prouverait la contrainte d'unicité en croyant prouver le verrou.

## Lancer la suite

```bash
PROJET1_TEST_DATABASE_URL=postgresql://user@host:port/base npm run test -w @cbd/api
```

Sans cette variable, la suite d'intégration est ignorée : un poste sans
PostgreSQL doit pouvoir lancer `npm test`. Le prix de ce choix est qu'une CI
muette passerait à côté. Deux garde-fous le limitent : si l'URL est fournie mais
la base injoignable, la préparation échoue et le processus sort en code 1 (même
si vitest affiche les tests comme « skipped », ce qui prête à confusion) ; et le
test `sanity` vérifie que la base est réellement migrée et porte bien l'index
partiel, plutôt que de supposer qu'une connexion réussie suffit.

Le jeu de données est préfixé par exécution et nettoyé en fin de suite : deux
runs concurrents ne se marchent pas dessus, et aucune ligne ne subsiste. Chaque
test repart en outre d'une base identique — sans cela, la charge des drivers
s'accumule d'un test à l'autre et un test échoue pour une raison étrangère à ce
qu'il vérifie.

## Ce qui a été branché sur la base

La couche qui manquait entre le moteur pur et la base : lire les candidats,
lire le point de retrait, faire tourner le tour.

- `drivers/prisma-repository.ts` — dépôt driver, **volontairement non tenanté** :
  un driver appartient au réseau, pas à un shop. Le scoper par `merchantId`
  découperait la flotte par boutique, c'est-à-dire détruirait l'intérêt d'un
  réseau mutualisé. L'étanchéité est déplacée, pas perdue : ce dépôt ne rend que
  des candidats, jamais de donnée commerciale, et toute lecture de course passe
  par le dépôt scopé.
- `deliveries/dispatch-context.ts` — lit le point de retrait (qui vient de la
  boutique, pas de la livraison), la zone, et le nombre de tours déjà joués.
- `deliveries/dispatch-planner.ts` — assemble l'état et lance le tour. N'ajoute
  aucune règle : tout ce qui décide vit dans `@cbd/domain`.
- `composition.ts` — la seule racine qui connaît Prisma.

Le garde-fou statique relit désormais ces fichiers aussi, et accepte les
requêtes du dépôt driver **une par une, avec justification écrite**. Il a été
étendu au passage : il ne lisait que les appels écrits `db.*` et manquait ceux
écrits `tx.*` dans une transaction imbriquée.

### Un driver sans position

Le moteur exigeait une position. La couche base aurait donc dû écarter elle-même
les drivers non localisés — et cette exclusion aurait disparu du journal de
dispatch, alors que tout l'intérêt de ce journal est de pouvoir répondre plus
tard à « pourquoi pas lui ». `DriverCandidate.position` est devenu nullable et
le moteur écarte lui-même, avec un motif nommé : `POSITION_UNKNOWN`, distance
`null` — et non zéro, qui l'aurait classé premier.
