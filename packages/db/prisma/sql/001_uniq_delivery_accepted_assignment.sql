-- Index partiel : au plus une proposition ACCEPTED *vivante* par livraison.
--
-- Prisma ne sait pas exprimer un index partiel dans `schema.prisma` : la
-- clause `WHERE` n'existe pas dans son langage de schéma. Cet index est donc
-- écrit à la main et doit être repris tel quel dans la première migration,
-- après les `CREATE TABLE` — sans quoi la contrainte n'existera qu'en
-- développement et la garantie tombera en production.
--
-- Ce qu'il garantit, et que le code seul ne garantit pas : même si le service
-- est contourné (script d'exploitation, correction manuelle, futur adaptateur),
-- PostgreSQL refuse une seconde acceptation vivante. Vérifié par SQL brut dans
-- `apps/api/src/deliveries/postgres.integration.test.ts`.
--
-- Il est *partiel* et pas simplement unique : un même `deliveryId` doit pouvoir
-- porter autant de propositions REJECTED, EXPIRED ou CANCELLED qu'il y a eu de
-- tours de dispatch. Un unique nu sur `deliveryId` casserait le dispatch.
--
-- Corollaire côté application, et il n'est pas optionnel : rendre une course
-- (UNASSIGNED, CANCELLED, FAILED) doit clore la proposition acceptée du driver
-- libéré. Sans cela, aucune réassignation n'est possible — c'est la divergence
-- P1-01, constatée contre une vraie base et corrigée dans
-- `apps/api/src/deliveries/service.ts` (CLOSES_LIVE_ASSIGNMENTS).

CREATE UNIQUE INDEX "uniq_delivery_accepted_assignment"
  ON "DeliveryAssignment" ("deliveryId")
  WHERE "status" = 'ACCEPTED';
