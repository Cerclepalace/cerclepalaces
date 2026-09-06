-- Mode de libération d'une commande vers la préparation.
--
-- La colonne est NOT NULL **sans valeur par défaut**, délibérément : chaque
-- création de commande doit dire de quel flux elle relève. Un défaut choisirait
-- à la place de l'appelant, et le mauvais défaut est silencieux dans les deux
-- sens — vers MERCHANT_DIRECT, une commande à confirmer contournerait sa
-- confirmation ; vers EXTERNAL_CONFIRMATION, une commande du pilote resterait
-- bloquée en panier.
--
-- Conséquence à connaître avant de rejouer cette migration ailleurs : sur une
-- base contenant déjà des commandes, PostgreSQL refusera l'ajout d'une colonne
-- NOT NULL sans défaut. Il faudra alors l'ajouter en nullable, remplir chaque
-- ligne selon le flux qu'elle a réellement suivi, puis poser la contrainte. Ce
-- cas n'existe pas aujourd'hui : aucune commande n'est en base.

-- CreateEnum
CREATE TYPE "OrderFulfillmentMode" AS ENUM ('EXTERNAL_CONFIRMATION', 'MERCHANT_DIRECT');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fulfillmentMode" "OrderFulfillmentMode" NOT NULL;
