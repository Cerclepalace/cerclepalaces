import { describe, expect, it } from "vitest";

import { ForbiddenError, assertAuthorized, authorize, type Principal } from "./guard.js";

const client: Principal = { userId: "usr_client", roles: ["customer"] };
const autreClient: Principal = { userId: "usr_autre", roles: ["customer"] };
const patron: Principal = {
  userId: "usr_patron",
  roles: ["merchant_owner"],
  merchantId: "mer_1",
};
const employé: Principal = {
  userId: "usr_employe",
  roles: ["merchant_staff"],
  merchantId: "mer_1",
  locationIds: ["loc_1"],
};
const coursier: Principal = { userId: "usr_coursier", roles: ["driver"], driverId: "crs_1" };
const autreCoursier: Principal = { userId: "usr_c2", roles: ["driver"], driverId: "crs_2" };
const support: Principal = { userId: "usr_support", roles: ["support_agent"] };
const admin: Principal = { userId: "usr_admin", roles: ["admin"] };

const commande = {
  kind: "order",
  customerId: "usr_client",
  locationId: "loc_1",
  assignedDriverId: "crs_1",
} as const;

describe("cloisonnement entre clients", () => {
  it("laisse un client consulter sa commande", () => {
    expect(authorize(client, "read", commande).allowed).toBe(true);
  });

  it("empêche un client de consulter la commande d'un autre", () => {
    expect(authorize(autreClient, "read", commande).allowed).toBe(false);
  });

  it("empêche un client de modifier sa propre commande directement", () => {
    expect(authorize(client, "write", commande).allowed).toBe(false);
  });

  it("empêche un client d'accéder au compte d'un autre", () => {
    expect(
      authorize(client, "read", { kind: "own_account", userId: "usr_autre" }).allowed,
    ).toBe(false);
  });
});

describe("cloisonnement entre commerçants", () => {
  it("laisse le patron accéder à toutes les locations de son commerce", () => {
    expect(
      authorize(patron, "write", { kind: "merchant_location", merchantId: "mer_1", locationId: "loc_9" })
        .allowed,
    ).toBe(true);
  });

  it("empêche le patron d'accéder à un autre commerce", () => {
    expect(
      authorize(patron, "read", { kind: "merchant_location", merchantId: "mer_2", locationId: "loc_5" })
        .allowed,
    ).toBe(false);
  });

  it("limite l'employé à ses propres points de vente", () => {
    expect(
      authorize(employé, "write", { kind: "merchant_location", merchantId: "mer_1", locationId: "loc_1" })
        .allowed,
    ).toBe(true);
    expect(
      authorize(employé, "write", { kind: "merchant_location", merchantId: "mer_1", locationId: "loc_2" })
        .allowed,
    ).toBe(false);
  });

  it("empêche un employé de voir une commande d'une autre boutique", () => {
    expect(
      authorize(employé, "read", { ...commande, locationId: "loc_2" }).allowed,
    ).toBe(false);
  });
});

describe("cloisonnement entre coursiers", () => {
  it("laisse le coursier assigné accéder à la commande", () => {
    expect(authorize(coursier, "read", commande).allowed).toBe(true);
  });

  it("empêche un autre coursier d'y accéder", () => {
    expect(authorize(autreCoursier, "read", commande).allowed).toBe(false);
  });

  it("empêche un coursier d'accéder à la mission d'un autre", () => {
    expect(
      authorize(coursier, "read", { kind: "driver_mission", driverId: "crs_2" }).allowed,
    ).toBe(false);
  });

  it("empêche un client de se faire passer pour un coursier", () => {
    expect(
      authorize(client, "read", { kind: "driver_mission", driverId: "crs_1" }).allowed,
    ).toBe(false);
  });
});

describe("rôles plateforme", () => {
  it("donne à l'admin un accès complet", () => {
    expect(authorize(admin, "write", commande).allowed).toBe(true);
    expect(authorize(admin, "read", { kind: "compliance_document" }).allowed).toBe(true);
    expect(authorize(admin, "write", { kind: "platform_settings" }).allowed).toBe(true);
  });

  it("limite le support à la lecture", () => {
    expect(authorize(support, "read", commande).allowed).toBe(true);
    expect(authorize(support, "write", commande).allowed).toBe(false);
    expect(authorize(support, "transition", commande).allowed).toBe(false);
  });

  it("ferme les documents de conformité au support", () => {
    expect(authorize(support, "read", { kind: "compliance_document" }).allowed).toBe(false);
  });
});

describe("documents de conformité", () => {
  it("ne sont accessibles à personne hors administration", () => {
    for (const principal of [client, patron, employé, coursier, support]) {
      expect(
        authorize(principal, "read", { kind: "compliance_document" }).allowed,
        `${principal.roles.join(",")} ne devrait pas y accéder`,
      ).toBe(false);
    }
  });
});

describe("refus par défaut", () => {
  it("refuse un utilisateur sans rôle sur toute ressource", () => {
    const anonyme: Principal = { userId: "usr_x", roles: [] };
    const ressources = [
      commande,
      { kind: "merchant_location", merchantId: "mer_1", locationId: "loc_1" },
      { kind: "driver_mission", driverId: "crs_1" },
      { kind: "compliance_document" },
      { kind: "platform_settings" },
    ] as const;

    for (const ressource of ressources) {
      expect(authorize(anonyme, "read", ressource).allowed, ressource.kind).toBe(false);
    }
  });

  it("refuse un commerçant sans rattachement", () => {
    const orphelin: Principal = { userId: "usr_o", roles: ["merchant_staff"] };
    expect(
      authorize(orphelin, "read", { kind: "merchant_location", merchantId: "mer_1", locationId: "loc_1" })
        .allowed,
    ).toBe(false);
  });
});

describe("assertAuthorized", () => {
  it("passe silencieusement quand c'est autorisé", () => {
    expect(() => assertAuthorized(client, "read", commande)).not.toThrow();
  });

  it("lève une ForbiddenError sinon", () => {
    expect(() => assertAuthorized(autreClient, "read", commande)).toThrow(ForbiddenError);
  });
});
