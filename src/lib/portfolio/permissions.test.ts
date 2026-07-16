import { describe, expect, it } from "vitest";
import { canEditFamilyData, canManageFamily } from "./permissions";

describe("portfolio permission matrix", () => {
  it("allows data edits only to editor and admin roles", () => {
    expect(canEditFamilyData("viewer")).toBe(false);
    expect(canEditFamilyData("editor")).toBe(true);
    expect(canEditFamilyData("admin")).toBe(true);
  });

  it("allows family management only to admin role", () => {
    expect(canManageFamily("viewer")).toBe(false);
    expect(canManageFamily("editor")).toBe(false);
    expect(canManageFamily("admin")).toBe(true);
  });

  it("denies permissions for missing or unknown roles", () => {
    expect(canEditFamilyData(null)).toBe(false);
    expect(canEditFamilyData(undefined)).toBe(false);
    expect(canEditFamilyData("owner")).toBe(false);
    expect(canManageFamily(null)).toBe(false);
    expect(canManageFamily(undefined)).toBe(false);
    expect(canManageFamily("owner")).toBe(false);
  });
});

