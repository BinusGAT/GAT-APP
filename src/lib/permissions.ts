export const PUBLIC_ROLE = "all";
export const ADMINISTRATOR_ROLE = "administrator";

export const ROLE_OPTIONS = [
  { id: PUBLIC_ROLE, label: "All Roles / Public" },
  { id: ADMINISTRATOR_ROLE, label: "Administrator" },
  { id: "intern", label: "Intern" },
  { id: "student", label: "Student" },
  { id: "lecturer", label: "Lecturer" },
] as const;

const ADMINISTRATOR_ALIASES = new Set(["admin", "administrator", "superadmin"]);

export type PermissionActor = {
  activeRole?: string | null;
  kind?: "user" | "superadmin";
  superadminUntil?: number;
} | null;

export type RoleRestrictedResource = {
  allowed_roles?: string | null;
};

export function normalizeRole(role: string): string {
  const normalized = role.trim().toLowerCase();
  return ADMINISTRATOR_ALIASES.has(normalized) ? ADMINISTRATOR_ROLE : normalized;
}

export function normalizeRoles(roles: string[]): string[] {
  return Array.from(new Set(roles.map(normalizeRole).filter(Boolean)));
}

export function isAdministratorRole(role: string | null | undefined): boolean {
  return !!role && normalizeRole(role) === ADMINISTRATOR_ROLE;
}

export function formatRoleName(role: string): string {
  const normalized = normalizeRole(role);
  if (normalized === ADMINISTRATOR_ROLE) return "Administrator";
  if (normalized === "intern") return "Intern";
  if (normalized === "student") return "Student";
  if (normalized === "lecturer") return "Lecturer";
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
}

export function parseAllowedRoles(allowedRoles: string | null | undefined): string[] {
  const normalized = normalizeRoles((allowedRoles || PUBLIC_ROLE).split(","));
  return normalized.length > 0 ? normalized : [PUBLIC_ROLE];
}

export function isPublicResource(resource: RoleRestrictedResource): boolean {
  return parseAllowedRoles(resource.allowed_roles).includes(PUBLIC_ROLE);
}

export function canAccessResource(actor: PermissionActor, resource: RoleRestrictedResource): boolean {
  if (isAdministratorRole(actor?.activeRole)) return true;
  const allowedRoles = parseAllowedRoles(resource.allowed_roles);
  if (allowedRoles.includes(PUBLIC_ROLE)) return true;
  const activeRole = actor?.activeRole ? normalizeRole(actor.activeRole) : "";
  return !!activeRole && allowedRoles.includes(activeRole);
}

export function canManageButtons(actor: PermissionActor): boolean {
  return isAdministratorRole(actor?.activeRole);
}

export function isSuperadminElevated(actor: PermissionActor, now = Date.now()): boolean {
  return !!actor && (actor.kind === "superadmin" ||
    (typeof actor.superadminUntil === "number" && actor.superadminUntil > now));
}

export function canManageUsers(actor: PermissionActor, now = Date.now()): boolean {
  return canManageButtons(actor) && isSuperadminElevated(actor, now);
}

export function canSwitchToRole(assignedRoles: string[], requestedRole: string): boolean {
  return normalizeRoles(assignedRoles).includes(normalizeRole(requestedRole));
}

export function serializeAllowedRoles(roles: string[]): string {
  const normalized = normalizeRoles(roles);
  if (normalized.length === 0 || normalized.includes(PUBLIC_ROLE)) return PUBLIC_ROLE;
  return [ADMINISTRATOR_ROLE, ...normalized.filter((role) => role !== ADMINISTRATOR_ROLE)].join(",");
}
