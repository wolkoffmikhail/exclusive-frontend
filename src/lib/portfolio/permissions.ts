export type FamilyRole = "admin" | "editor" | "viewer" | string;

export function canEditFamilyData(role: FamilyRole | null | undefined) {
  return role === "admin" || role === "editor";
}

export function canManageFamily(role: FamilyRole | null | undefined) {
  return role === "admin";
}

