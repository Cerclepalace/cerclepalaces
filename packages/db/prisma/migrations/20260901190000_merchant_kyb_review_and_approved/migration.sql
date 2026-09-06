-- Deux états de plus sur le cycle de vie d'un shop.
--
-- `KYB_REVIEW` : le dossier est déposé et attend un examen.
-- `APPROVED`   : le dossier est validé, et le shop **ne vend pas encore**.
--
-- Valider un dossier et ouvrir un commerce sont deux décisions distinctes,
-- prises à des moments différents et parfois par des personnes différentes. Les
-- fondre en une seule ferait qu'approuver un KYB mettrait un shop en ligne — ce
-- que personne ne veut au moment où il signe l'approbation. Seul `ACTIVE` vend.
--
-- Migration purement additive : `ALTER TYPE ... ADD VALUE` n'invalide aucune
-- ligne existante et ne réécrit aucune donnée. Les shops déjà `ACTIVE` ou
-- `PENDING_VALIDATION` gardent leur état ; aucun n'est déplacé automatiquement,
-- parce qu'aucun code ne peut savoir si un shop existant a vu son dossier
-- réellement examiné.
--
-- PostgreSQL 12 et suivants acceptent plusieurs ADD VALUE dans une transaction.
-- Ce dépôt cible PostgreSQL 16.

-- AlterEnum
ALTER TYPE "MerchantStatus" ADD VALUE 'KYB_REVIEW';
ALTER TYPE "MerchantStatus" ADD VALUE 'APPROVED';
