-- Aligne le schéma sur le domaine : taxonomie fermée, certificat complet,
-- champs critiques du KYB.
--
-- Écrite à la main plutôt que générée : le script produit par Prisma faisait un
-- `DROP COLUMN "thcContent"` sec, ce qui perd la mesure sur une base contenant
-- déjà des dossiers. La forme retenue est ajout → report → suppression, qui se
-- comporte identiquement sur une base vide et sur une base peuplée.

-- ---------------------------------------------------------------------------
-- 1. Taxonomie de conformité, fermée
-- ---------------------------------------------------------------------------
-- Remplace la table `ProductCategory`, arbre à slugs libres. Deux systèmes de
-- catégories concurrents, dont l'un ouvert, redonnaient à un produit une porte
-- que la taxonomie fermée venait de fermer.

-- L'ordre compte : en PostgreSQL, une table occupe l'espace de noms des types.
-- Tant que la table `ProductCategory` existe, l'énumération du même nom ne peut
-- pas être créée. La table part donc en premier, après le garde-fou.
--
-- Aucun report automatique depuis l'ancien `categoryId`. Un slug libre ne se
-- traduit pas en valeur d'énumération sans décider à la place d'un humain, et
-- se tromper de catégorie est précisément ce que la taxonomie doit empêcher.
-- Les produits déjà classés repartent donc **non classés**, ce qui les bloque à
-- la mise en vente jusqu'à reclassement — l'échec est du côté sûr.
--
-- Le garde-fou ci-dessous rend ce choix visible : si des produits étaient
-- classés, la migration s'arrête et exige une reprise explicite.
DO $$
DECLARE classés INTEGER;
BEGIN
  SELECT count(*) INTO classés FROM "Product" WHERE "categoryId" IS NOT NULL;
  IF classés > 0 THEN
    RAISE EXCEPTION
      'Migration interrompue : % produit(s) portent une catégorie libre. '
      'Aucun report automatique vers la taxonomie fermée n''est fiable. '
      'Reclasser ces produits, vider "Product"."categoryId", puis rejouer.',
      classés;
  END IF;
END $$;

ALTER TABLE "Product" DROP CONSTRAINT "Product_categoryId_fkey";
DROP INDEX "Product_categoryId_idx";
ALTER TABLE "Product" DROP COLUMN "categoryId";

ALTER TABLE "ProductCategory" DROP CONSTRAINT "ProductCategory_parentId_fkey";
DROP TABLE "ProductCategory";

CREATE TYPE "ProductCategory" AS ENUM (
  'FLOWER', 'RESIN', 'OIL_NON_FOOD', 'COSMETIC', 'FOOD',
  'SUPPLEMENT', 'VAPE', 'ACCESSORY', 'OTHER', 'PROHIBITED_DERIVATIVE'
);

ALTER TABLE "Product" ADD COLUMN "category" "ProductCategory";
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- ---------------------------------------------------------------------------
-- 2. Certificat d'analyse : delta-9, THC total, laboratoire, date d'émission
-- ---------------------------------------------------------------------------
-- Le delta-9 porte le plafond ; le THC total est informatif et agrège des
-- formes qui n'ont pas le même statut. Les confondre dans un sens refuserait des
-- produits conformes, dans l'autre en laisserait passer.

ALTER TABLE "ProductCompliance" ADD COLUMN "delta9ThcPercent" DECIMAL(6,4);
ALTER TABLE "ProductCompliance" ADD COLUMN "totalThcPercent"  DECIMAL(6,4);
ALTER TABLE "ProductCompliance" ADD COLUMN "laboratory"       TEXT;
ALTER TABLE "ProductCompliance" ADD COLUMN "issuedAt"         TIMESTAMP(3);

-- Report : l'ancien `thcContent` était une mesure unique, sans indication de la
-- forme mesurée. On la reprend comme delta-9 parce que c'est celle qu'un plafond
-- oppose, et `totalThcPercent` reste vide — inventer un total à partir d'un
-- chiffre dont on ignore la nature serait fabriquer une donnée.
UPDATE "ProductCompliance" SET "delta9ThcPercent" = "thcContent" WHERE "thcContent" IS NOT NULL;

ALTER TABLE "ProductCompliance" DROP COLUMN "thcContent";

-- ---------------------------------------------------------------------------
-- 3. Champs critiques du KYB
-- ---------------------------------------------------------------------------
-- Leur modification renvoie le shop à l'examen. Ni le bénéficiaire effectif ni
-- le compte bancaire ne sont stockés en clair : seules des références opaques
-- sont comparées, car détecter un changement n'exige pas de connaître la valeur.

ALTER TABLE "Merchant" ADD COLUMN "legalForm"          TEXT;
ALTER TABLE "Merchant" ADD COLUMN "beneficialOwnerRef" TEXT;
ALTER TABLE "Merchant" ADD COLUMN "bankAccountRef"     TEXT;
