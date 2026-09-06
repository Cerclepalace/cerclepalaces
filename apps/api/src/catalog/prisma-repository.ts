/**
 * Adaptateur Prisma du candidat à la mise en vente.
 *
 * Deux disciplines gouvernent ce fichier.
 *
 * **1. Aucune correspondance implicite.** La base porte encore un champ libre :
 * `ComplianceDocument.kind`. Le domaine, lui, a une liste fermée. La traduction
 * est écrite ici, valeur par valeur, et une valeur inconnue n'est **pas**
 * rattachée au plus proche voisin : elle est écartée. Un certificat d'analyse
 * mal étiqueté doit manquer, pas être deviné — sinon la garde qui exige un COA
 * se contenterait de n'importe quelle pièce.
 *
 * **2. Rien n'est fabriqué.** Un taux absent en base reste absent dans le
 * domaine. Le THC total n'est jamais déduit du delta-9 : ce sont deux mesures
 * différentes, et en calculer une à partir de l'autre inventerait une donnée
 * d'analyse.
 *
 * La portée tenant passe par `Inventory`, qui porte `merchantId` : c'est le
 * référencement d'un produit **par un shop** qui est tenanté, pas le produit,
 * qui peut appartenir à un catalogue partagé.
 */

import type { Prisma, PrismaClient } from "@cbd/db";
import {
  isProductCategory,
  type ComplianceDocumentKind,
  type ComplianceStatus,
  type ListingCandidate,
  type MerchantStatus,
  type ProductCategory,
  type TenantScope,
} from "@cbd/domain";

import type {
  ListingCandidateKey,
  ListingCandidateLookup,
  ListingCandidateRepository,
} from "./repository.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Correspondance explicite entre la valeur libre stockée et la liste fermée.
 *
 * Écrite plutôt que déduite. Toute valeur absente de cette table est écartée —
 * jamais rapprochée d'une voisine.
 */
const KINDS: ReadonlyMap<string, ComplianceDocumentKind> = new Map([
  ["CERTIFICATE_OF_ANALYSIS", "CERTIFICATE_OF_ANALYSIS"],
  ["SUPPLIER_SHEET", "SUPPLIER_SHEET"],
  ["PRODUCT_LABEL", "PRODUCT_LABEL"],
  ["OTHER", "OTHER"],
]);

/** `Decimal` de Prisma → nombre, sans jamais inventer une valeur absente. */
function toPercent(valeur: Prisma.Decimal | null): number | null {
  if (valeur === null) return null;
  const nombre = Number(valeur);
  // Une valeur illisible n'est pas zéro : elle est inconnue. Le domaine la
  // refusera comme mesure invalide plutôt que de la traiter comme conforme.
  return Number.isFinite(nombre) ? nombre : Number.NaN;
}

/**
 * La catégorie stockée est une valeur d'énumération PostgreSQL, donc déjà
 * contrainte. Le contrôle est refait ici parce qu'une colonne peut être élargie
 * par une migration future sans que le domaine le sache.
 */
function toCategory(valeur: string | null): ProductCategory | null {
  if (valeur === null) return null;
  return isProductCategory(valeur) ? valeur : null;
}

export function createListingCandidateRepository(db: Db): ListingCandidateRepository {
  return {
    async findCandidate(
      scope: TenantScope,
      key: ListingCandidateKey,
    ): Promise<ListingCandidateLookup> {
      const inventory = await db.inventory.findFirst({
        where: {
          productId: key.productId,
          locationId: key.locationId,
          merchantId: scope.merchantId,
        },
        select: { priceCents: true, stock: true, isListed: true },
      });
      if (!inventory) return { found: false, reason: "NOT_IN_INVENTORY" };

      const product = await db.product.findFirst({
        where: { id: key.productId, inventory: { some: { merchantId: scope.merchantId } } },
        select: {
          name: true,
          category: true,
          compliance: {
            select: {
              status: true,
              delta9ThcPercent: true,
              totalThcPercent: true,
              cbdContent: true,
              composition: true,
              supplier: true,
              batchNumber: true,
              laboratory: true,
              issuedAt: true,
              expiresAt: true,
              documents: { select: { kind: true } },
            },
          },
        },
      });
      if (!product) return { found: false, reason: "PRODUCT_NOT_FOUND" };

      const compliance = product.compliance;
      if (!compliance) return { found: false, reason: "NO_COMPLIANCE_RECORD" };

      const merchant = await db.merchant.findFirst({
        where: { id: scope.merchantId },
        select: {
          status: true,
          legalName: true,
          tradeName: true,
          registrationNumber: true,
          locations: {
            select: { line1: true, line2: true, postalCode: true, city: true, country: true },
          },
          _count: { select: { staff: { where: { role: "merchant_owner" } } } },
        },
      });
      if (!merchant) return { found: false, reason: "PRODUCT_NOT_FOUND" };

      const documentKinds = compliance.documents
        .map((document) => KINDS.get(document.kind))
        .filter((kind): kind is ComplianceDocumentKind => kind !== undefined);

      const candidate: ListingCandidate = {
        merchantStatus: merchant.status as MerchantStatus,
        kyb: {
          legalName: merchant.legalName,
          tradeName: merchant.tradeName,
          registrationNumber: merchant.registrationNumber,
          locations: merchant.locations.map((location) => ({
            line1: location.line1,
            postalCode: location.postalCode,
            city: location.city,
            country: location.country,
          })),
          ownerCount: merchant._count.staff,
        },
        complianceStatus: compliance.status as ComplianceStatus,
        complianceExpiresAt: compliance.expiresAt,
        submission: {
          productName: product.name,
          laboratory: compliance.laboratory,
          batchNumber: compliance.batchNumber,
          supplier: compliance.supplier,
          delta9ThcPercent: toPercent(compliance.delta9ThcPercent),
          // Jamais déduit du delta-9 : deux mesures différentes.
          totalThcPercent: toPercent(compliance.totalThcPercent),
          cbdContent: toPercent(compliance.cbdContent),
          issuedAt: compliance.issuedAt,
          expiresAt: compliance.expiresAt,
          documentKinds,
        },
        categorySlug: toCategory(product.category),
        // La composition est stockée en texte libre. Elle est transmise telle
        // quelle, en une seule entrée : l'appariement des substances se fait par
        // occurrence dans le texte, et découper sur une ponctuation devinée
        // ferait perdre les noms composés.
        declaredComposition: compliance.composition === null ? [] : [compliance.composition],
        // Aucune table d'analyses n'existe : les seules mesures persistées sont
        // celles du certificat, que le portail ajoute lui-même.
        declaredAnalytes: [],
        isListed: inventory.isListed,
        stock: inventory.stock,
        priceCents: inventory.priceCents,
      };

      return { found: true, candidate };
    },
  };
}
