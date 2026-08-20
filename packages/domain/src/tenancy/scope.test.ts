import { describe, expect, it } from "vitest";

import {
  InvalidTenantScopeError,
  TenantMismatchError,
  adminScope,
  assertBelongsToTenant,
  tenantFilter,
  tenantScope,
} from "./scope.js";

describe("fabrication d'un scope", () => {
  it("porte le merchantId fourni", () => {
    expect(tenantScope("mer_1").merchantId).toBe("mer_1");
  });

  it("refuse un merchantId vide ou blanc", () => {
    expect(() => tenantScope("")).toThrow(InvalidTenantScopeError);
    expect(() => tenantScope("   ")).toThrow(InvalidTenantScopeError);
  });

  it("refuse une valeur qui n'est pas une chaîne", () => {
    expect(() => tenantScope(undefined as unknown as string)).toThrow(InvalidTenantScopeError);
    expect(() => tenantScope(null as unknown as string)).toThrow(InvalidTenantScopeError);
  });
});

// TEST 7 de la mission : un scope ne se fabrique pas au hasard.
describe("le scope est un type nominal", () => {
  it("ne peut pas être remplacé par un objet littéral", () => {
    // @ts-expect-error un { merchantId } nu n'est pas un TenantScope
    const faux: TenantScope = { merchantId: "mer_1" };
    expect(faux).toBeDefined();
  });

  it("ne peut pas être remplacé par une chaîne", () => {
    // @ts-expect-error une chaîne n'est pas un TenantScope
    const faux: TenantScope = "mer_1";
    expect(faux).toBeDefined();
  });

  it("n'accepte pas un AdminScope à sa place", () => {
    // @ts-expect-error AdminScope ne se substitue jamais à TenantScope
    const faux: TenantScope = adminScope("usr_admin");
    expect(faux).toBeDefined();
  });
});

describe("portée administrateur", () => {
  it("exige l'identifiant de l'administrateur", () => {
    expect(adminScope("usr_admin").actorUserId).toBe("usr_admin");
    expect(() => adminScope("")).toThrow(InvalidTenantScopeError);
  });

  it("n'est pas interchangeable avec un TenantScope", () => {
    // @ts-expect-error TenantScope ne se substitue jamais à AdminScope
    const faux: AdminScope = tenantScope("mer_1");
    expect(faux).toBeDefined();
  });
});

describe("garde d'appartenance", () => {
  it("laisse passer une ressource du bon tenant", () => {
    expect(() => assertBelongsToTenant(tenantScope("mer_1"), { merchantId: "mer_1" })).not.toThrow();
  });

  it("rejette une ressource d'un autre tenant", () => {
    expect(() => assertBelongsToTenant(tenantScope("mer_1"), { merchantId: "mer_2" })).toThrow(
      TenantMismatchError,
    );
  });

  it("ne révèle pas à qui appartient réellement la ressource", () => {
    try {
      assertBelongsToTenant(tenantScope("mer_1"), { merchantId: "mer_2" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("mer_2");
      expect((error as TenantMismatchError).status).toBe(404);
    }
  });
});

describe("filtre de requête", () => {
  it("produit un where scopé", () => {
    expect(tenantFilter(tenantScope("mer_1"))).toEqual({ merchantId: "mer_1" });
  });
});
