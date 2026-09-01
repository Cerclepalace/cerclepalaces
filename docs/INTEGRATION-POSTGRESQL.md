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
muette passerait à côté — d'où le test `sanity`, qui échoue bruyamment si l'URL
est fournie mais la base absente ou non migrée.

Le jeu de données est préfixé par exécution et nettoyé en fin de suite : deux
runs concurrents ne se marchent pas dessus, et aucune ligne ne subsiste.
