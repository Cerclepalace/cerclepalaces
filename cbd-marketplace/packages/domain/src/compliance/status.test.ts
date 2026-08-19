import { describe, expect, it } from "vitest";

import {
  COMPLIANCE_STATUSES,
  canChangeCompliance,
  isOrderable,
  isSellable,
  type ComplianceStatus,
} from "./status.js";

describe("isSellable", () => {
  it("n'autorise que APPROVED", () => {
    for (const status of COMPLIANCE_STATUSES) {
      expect(isSellable(status)).toBe(status === "APPROVED");
    }
  });
});

describe("isOrderable", () => {
  const base = { compliance: "APPROVED" as ComplianceStatus, stock: 5, listedByMerchant: true };

  it("accepte un produit conforme, listé et en stock", () => {
    expect(isOrderable(base)).toBe(true);
  });

  it("refuse un produit en stock mais non conforme", () => {
    for (const status of COMPLIANCE_STATUSES) {
      if (status === "APPROVED") continue;
      expect(isOrderable({ ...base, compliance: status })).toBe(false);
    }
  });

  it("refuse un produit conforme mais en rupture chez ce shop", () => {
    expect(isOrderable({ ...base, stock: 0 })).toBe(false);
  });

  it("refuse un produit conforme et en stock mais retiré par le commerçant", () => {
    expect(isOrderable({ ...base, listedByMerchant: false })).toBe(false);
  });
});

describe("transitions de conformité", () => {
  it("réserve la validation à l'admin", () => {
    expect(canChangeCompliance("PENDING_REVIEW", "APPROVED", "admin")).toBe(true);
    expect(canChangeCompliance("PENDING_REVIEW", "APPROVED", "merchant_owner")).toBe(false);
  });

  it("laisse le commerçant resoumettre un dossier refusé ou expiré", () => {
    expect(canChangeCompliance("REJECTED", "PENDING_REVIEW", "merchant_owner")).toBe(true);
    expect(canChangeCompliance("EXPIRED", "PENDING_REVIEW", "merchant_staff")).toBe(true);
  });

  it("interdit au commerçant de se réapprouver après suspension", () => {
    expect(canChangeCompliance("SUSPENDED", "APPROVED", "merchant_owner")).toBe(false);
    expect(canChangeCompliance("SUSPENDED", "APPROVED", "admin")).toBe(true);
  });

  it("permet au système d'expirer un certificat périmé", () => {
    expect(canChangeCompliance("APPROVED", "EXPIRED", "system")).toBe(true);
  });
});
