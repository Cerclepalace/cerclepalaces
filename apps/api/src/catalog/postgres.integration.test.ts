/**
 * Le parcours complet, contre une vraie base.
 *
 * Un audit a montré que la taxonomie fermée existait des deux côtés — dans le
 * domaine et dans PostgreSQL — sans qu'aucun code ne relie les deux. Une
 * migration réussie ne prouve rien tant que personne ne traverse le pont.
 *
 * Cette suite écrit en base, relit par l'adaptateur, et fait passer le résultat
 * par le portail. Ce qu'elle vérifie n'est pas que PostgreSQL refuse une
 * catégorie inconnue — c'est que la valeur persistée arrive intacte jusqu'à la
 * décision de mise en vente.
 */

import { createPrismaClient, type PrismaClient } from "@cbd/db";
import {
  EMPTY_CATALOGUE_POLICY,
  evaluateListing,
  tenantScope,
  type CataloguePolicy,
  type LegalEvidence,
  type TenantScope,
} from "@cbd/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createListingCandidateRepository } from "./prisma-repository.js";

const DATABASE_URL = process.env["PROJET1_TEST_DATABASE_URL"];
const RUN = `cat${Date.now().toString(36)}`;
const id = (suffix: string): string => `${RUN}_${suffix}`;

const NOW = new Date("2026-09-02T10:00:00Z");
const jours = (n: number): Date => new Date(NOW.getTime() + n * 86_400_000);

const preuve: LegalEvidence = {
  id: "ev_test",
  kind: "OFFICIAL_PUBLICATION",
  reference: "Référence citable de la source",
  sourceUrl: null,
  status: "VERIFIED",
  verifiedAt: jours(-30),
  verifiedBy: "juriste@example.test",
};

/**
 * Politique de test. Catégorie, seuil et analytes sont **fictifs** : ils
 * vérifient le mécanisme, ils n'énoncent aucune règle. Le seuil de 0,3 % sur le
 * delta-9 est une valeur de travail, révisable, et ne figure nulle part dans le
 * code source.
 */
const POLITIQUE: CataloguePolicy = {
  evidence: [preuve],
  categories: [
    { categorySlug: "FLOWER", decision: "ALLOWED", evidenceIds: ["ev_test"], decidedAt: jours(-30), note: null },
    { categorySlug: "FOOD", decision: "PROHIBITED", evidenceIds: [], decidedAt: jours(-30), note: null },
  ],
  prohibitedSubstances: [
    { substance: "SUBSTANCE-FICTIVE-X", aliases: ["SubstanceFictiveXAcetate"], evidenceIds: [], decidedAt: jours(-30) },
  ],
  analytes: [
    { analyte: "DELTA9_THC", decision: "RESTRICTED", maxPercent: 0.3, evidenceIds: ["ev_test"], decidedAt: jours(-30) },
    { analyte: "TOTAL_THC", decision: "UNRESTRICTED", maxPercent: null, evidenceIds: [], decidedAt: jours(-30) },
  ],
  conditionalAnalytes: [],
  reviewedAt: jours(-10),
  maxAgeDays: 180,
};

describe.skipIf(DATABASE_URL === undefined)("catalogue : DB → adaptateur → portail", () => {
  let prisma: PrismaClient;
  let scope: TenantScope;
  let autre: TenantScope;
  let repo: ReturnType<typeof createListingCandidateRepository>;

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL);
    repo = createListingCandidateRepository(prisma);
    scope = tenantScope(id("mer_a"));
    autre = tenantScope(id("mer_b"));

    for (const suffix of ["a", "b"] as const) {
      await prisma.merchant.create({
        data: {
          id: id(`mer_${suffix}`),
          legalName: `Shop ${suffix} SAS`,
          tradeName: `Shop ${suffix}`,
          registrationNumber: "912 345 678 00019",
          legalForm: "SAS",
          beneficialOwnerRef: `person-${suffix}`,
          bankAccountRef: `sha256:${suffix}`,
          status: "ACTIVE",
        },
      });
      await prisma.merchantLocation.create({
        data: {
          id: id(`loc_${suffix}`),
          merchantId: id(`mer_${suffix}`),
          slug: id(`loc-${suffix}`),
          name: `Boutique ${suffix}`,
          line1: "1 place de la République",
          postalCode: "75011",
          city: "Paris",
          lat: 48.8674,
          lng: 2.3636,
        },
      });
      await prisma.user.create({
        data: { id: id(`usr_${suffix}`), email: `${RUN}.${suffix}@example.test` },
      });
      await prisma.merchantStaff.create({
        data: {
          id: id(`stf_${suffix}`),
          userId: id(`usr_${suffix}`),
          merchantId: id(`mer_${suffix}`),
          role: "merchant_owner",
        },
      });
    }
  }, 30_000);

  afterAll(async () => {
    if (prisma === undefined) return;
    await prisma.product.deleteMany({ where: { id: { startsWith: RUN } } });
    await prisma.merchant.deleteMany({ where: { id: { startsWith: RUN } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: `${RUN}.` } } });
    await prisma.$disconnect();
  }, 30_000);

  beforeEach(async () => {
    await prisma.product.deleteMany({ where: { id: { startsWith: RUN } } });
    await prisma.merchant.updateMany({
      where: { id: { startsWith: RUN } },
      data: { status: "ACTIVE" },
    });
  });

  /** Écrit un produit complet et conforme, et rend sa clé. */
  async function seedProduit(overrides: {
    readonly category?: "FLOWER" | "FOOD" | "OTHER" | "PROHIBITED_DERIVATIVE" | null;
    readonly delta9?: number | null;
    readonly total?: number | null;
    readonly laboratory?: string | null;
    readonly composition?: string | null;
    readonly documentKind?: string;
    readonly merchant?: "a" | "b";
  } = {}) {
    const suffix = overrides.merchant ?? "a";
    const productId = id("prd");

    await prisma.product.create({
      data: {
        id: productId,
        name: "Produit de test",
        merchantId: id(`mer_${suffix}`),
        category: overrides.category === undefined ? "FLOWER" : overrides.category,
        compliance: {
          create: {
            id: id("pc"),
            status: "APPROVED",
            delta9ThcPercent: overrides.delta9 === undefined ? 0.2 : overrides.delta9,
            totalThcPercent: overrides.total === undefined ? 0.25 : overrides.total,
            cbdContent: 12,
            composition: overrides.composition === undefined ? "fleur de chanvre" : overrides.composition,
            supplier: "Fournisseur de test",
            batchNumber: "LOT-TEST-1",
            laboratory: overrides.laboratory === undefined ? "Laboratoire de test" : overrides.laboratory,
            issuedAt: jours(-5),
            expiresAt: jours(300),
            documents: {
              create: { id: id("doc"), kind: overrides.documentKind ?? "CERTIFICATE_OF_ANALYSIS", fileUrl: "https://example.test/coa.pdf" },
            },
          },
        },
        inventory: {
          create: {
            id: id("inv"),
            merchantId: id(`mer_${suffix}`),
            locationId: id(`loc_${suffix}`),
            priceCents: 1_190,
            stock: 10,
            isListed: true,
          },
        },
      },
    });

    return { productId, locationId: id(`loc_${suffix}`) };
  }

  const lire = async (clé: { productId: string; locationId: string }, s = scope) =>
    repo.findCandidate(s, clé);

  it("mène un produit persisté jusqu'à SELLABLE", async () => {
    const clé = await seedProduit();
    const lookup = await lire(clé);

    expect(lookup.found).toBe(true);
    if (!lookup.found) return;

    // La catégorie a traversé la base, l'adaptateur et le domaine sans se
    // transformer.
    expect(lookup.candidate.categorySlug).toBe("FLOWER");
    expect(lookup.candidate.merchantStatus).toBe("ACTIVE");
    expect(lookup.candidate.submission.laboratory).toBe("Laboratoire de test");
    expect(lookup.candidate.submission.documentKinds).toEqual(["CERTIFICATE_OF_ANALYSIS"]);

    expect(evaluateListing(lookup.candidate, POLITIQUE, NOW)).toEqual({
      listable: true,
      findings: [],
      blockers: [],
    });
  });

  it("relit le delta-9 et le THC total comme deux valeurs distinctes", async () => {
    const clé = await seedProduit({ delta9: 0.21, total: 0.87 });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");

    expect(lookup.candidate.submission.delta9ThcPercent).toBe(0.21);
    expect(lookup.candidate.submission.totalThcPercent).toBe(0.87);
    // Le total dépasse largement le plafond du delta-9 : il ne doit rien
    // déclencher, puisque le plafond ne porte pas sur lui.
    expect(evaluateListing(lookup.candidate, POLITIQUE, NOW).listable).toBe(true);
  });

  it("ne fabrique jamais un THC total absent", async () => {
    const clé = await seedProduit({ total: null });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");

    // Absent en base, absent dans le domaine. Aucun calcul depuis le delta-9.
    expect(lookup.candidate.submission.totalThcPercent).toBeNull();
    expect(lookup.candidate.submission.delta9ThcPercent).toBe(0.2);
    expect(evaluateListing(lookup.candidate, POLITIQUE, NOW).listable).toBe(true);
  });

  it("bloque un delta-9 persisté au-dessus du plafond de la politique", async () => {
    const clé = await seedProduit({ delta9: 0.9 });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");

    const verdict = evaluateListing(lookup.candidate, POLITIQUE, NOW);
    expect(verdict.listable).toBe(false);
    expect(verdict.blockers).toContain("ANALYTE_ABOVE_LIMIT");
  });

  it("bloque un delta-9 absent en base", async () => {
    const clé = await seedProduit({ delta9: null });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");

    const verdict = evaluateListing(lookup.candidate, POLITIQUE, NOW);
    expect(verdict.blockers).toContain("SUBMISSION_INCOMPLETE");
    expect(verdict.blockers).toContain("ANALYTE_NOT_DECLARED");
  });

  it("bloque un delta-9 persisté avec une valeur impossible", async () => {
    // La colonne accepte un négatif ; c'est au domaine de le refuser.
    const clé = await seedProduit({ delta9: -0.5 });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");

    expect(lookup.candidate.submission.delta9ThcPercent).toBe(-0.5);
    const verdict = evaluateListing(lookup.candidate, POLITIQUE, NOW);
    expect(verdict.listable).toBe(false);
    expect(verdict.blockers).toContain("SUBMISSION_INCOMPLETE");
    expect(verdict.blockers).toContain("ANALYTE_UNDECIDED");
  });

  it("bloque une catégorie interdite lue depuis la base", async () => {
    const clé = await seedProduit({ category: "FOOD" });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");
    expect(evaluateListing(lookup.candidate, POLITIQUE, NOW).blockers).toContain(
      "CATEGORY_PROHIBITED",
    );
  });

  it("bloque PROHIBITED_DERIVATIVE même si la politique l'autorise", async () => {
    const clé = await seedProduit({ category: "PROHIBITED_DERIVATIVE" });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");

    const complaisante: CataloguePolicy = {
      ...POLITIQUE,
      categories: [
        ...POLITIQUE.categories,
        { categorySlug: "PROHIBITED_DERIVATIVE", decision: "ALLOWED", evidenceIds: ["ev_test"], decidedAt: jours(-30), note: null },
      ],
    };
    expect(evaluateListing(lookup.candidate, complaisante, NOW).blockers).toContain(
      "CATEGORY_PROHIBITED",
    );
  });

  it("bloque OTHER, qui n'est pas un classement", async () => {
    const clé = await seedProduit({ category: "OTHER" });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");
    expect(evaluateListing(lookup.candidate, POLITIQUE, NOW).blockers).toContain(
      "CATEGORY_UNCLASSIFIED",
    );
  });

  it("bloque un produit jamais classé", async () => {
    const clé = await seedProduit({ category: null });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");
    expect(lookup.candidate.categorySlug).toBeNull();
    expect(evaluateListing(lookup.candidate, POLITIQUE, NOW).blockers).toContain("CATEGORY_MISSING");
  });

  it("écarte une pièce dont le type stocké n'existe pas dans la liste fermée", async () => {
    // Pas de rapprochement au plus proche voisin : un COA mal étiqueté doit
    // manquer, sinon la garde qui l'exige se contenterait de n'importe quoi.
    const clé = await seedProduit({ documentKind: "certificat d'analyse" });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");

    expect(lookup.candidate.submission.documentKinds).toEqual([]);
    expect(evaluateListing(lookup.candidate, POLITIQUE, NOW).blockers).toContain(
      "SUBMISSION_INCOMPLETE",
    );
  });

  it("bloque un laboratoire absent en base", async () => {
    const clé = await seedProduit({ laboratory: null });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");
    expect(evaluateListing(lookup.candidate, POLITIQUE, NOW).blockers).toContain(
      "SUBMISSION_INCOMPLETE",
    );
  });

  it("retrouve une substance interdite citée dans la composition persistée", async () => {
    const clé = await seedProduit({
      composition: "fleur de chanvre enrichie en substance-fictive-x, 12 %",
    });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");
    expect(evaluateListing(lookup.candidate, POLITIQUE, NOW).blockers).toContain(
      "SUBSTANCE_PROHIBITED",
    );
  });

  it("bloque un shop qui n'est plus ACTIVE en base", async () => {
    const clé = await seedProduit();
    await prisma.merchant.update({
      where: { id: id("mer_a") },
      data: { status: "KYB_REVIEW" },
    });
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");

    expect(lookup.candidate.merchantStatus).toBe("KYB_REVIEW");
    expect(evaluateListing(lookup.candidate, POLITIQUE, NOW).blockers).toContain(
      "MERCHANT_NOT_ACTIVE",
    );
  });

  it("bloque tout sous une politique vide, même sur des données valides", async () => {
    const clé = await seedProduit();
    const lookup = await lire(clé);
    if (!lookup.found) throw new Error("candidat introuvable");
    expect(evaluateListing(lookup.candidate, EMPTY_CATALOGUE_POLICY, NOW).listable).toBe(false);
  });

  it("ne laisse pas un shop lire le produit d'un autre", async () => {
    const clé = await seedProduit();
    expect(await lire(clé, autre)).toEqual({ found: false, reason: "NOT_IN_INVENTORY" });
  });

  it("distingue les trois raisons d'absence", async () => {
    expect(
      await lire({ productId: id("inconnu"), locationId: id("loc_a") }),
    ).toEqual({ found: false, reason: "NOT_IN_INVENTORY" });
  });
});
