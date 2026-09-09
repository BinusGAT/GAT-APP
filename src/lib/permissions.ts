export const PUBLIC_ROLE = "public";
export const ALL_ROLES = "all_roles";
export const ADMINISTRATOR_ROLE = "administrator";

export const SPECIFIC_ROLES = ["intern", "student", "lecturer"] as const;

export const ROLE_OPTIONS = [
  { id: PUBLIC_ROLE, label: "Public (No login required)" },
  { id: ALL_ROLES, label: "All Roles (Authenticated only)" },
  { id: ADMINISTRATOR_ROLE, label: "Administrator (Always has access)" },
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
  if (ADMINISTRATOR_ALIASES.has(normalized)) return ADMINISTRATOR_ROLE;
  if (normalized === "all" || normalized === "public") return PUBLIC_ROLE;
  if (normalized === "all_roles" || normalized === "authenticated") return ALL_ROLES;
  return normalized;
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
  if (normalized === PUBLIC_ROLE) return "Public";
  if (normalized === ALL_ROLES) return "All Roles";
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
}

export function formatRoleBadge(allowedRolesStr: string | null | undefined): { label: string; bg: string; color: string } {
  const roles = parseAllowedRoles(allowedRolesStr);
  if (roles.includes(PUBLIC_ROLE)) {
    return { label: "Public", bg: "rgba(16, 185, 129, 0.1)", color: "#10b981" };
  }
  if (roles.includes(ALL_ROLES)) {
    return { label: "All Roles", bg: "rgba(99, 102, 241, 0.1)", color: "#6366f1" };
  }
  const specifics = SPECIFIC_ROLES.filter((r) => roles.includes(r));
  if (specifics.length === 0) {
    return { label: "Admin Only", bg: "rgba(239, 68, 68, 0.1)", color: "#ef4444" };
  }
  return {
    label: specifics.map((r) => formatRoleName(r)).join(", "),
    bg: "rgba(139, 92, 246, 0.1)",
    color: "#8b5cf6",
  };
}

export function parseAllowedRoles(allowedRoles: string | null | undefined): string[] {
  if (!allowedRoles) return [ADMINISTRATOR_ROLE];
  const parts = allowedRoles.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return [ADMINISTRATOR_ROLE];

  // If contains public or legacy "all"
  if (parts.includes(PUBLIC_ROLE) || parts.includes("all")) {
    return [PUBLIC_ROLE];
  }

  // If contains all_roles or authenticated
  if (parts.includes(ALL_ROLES) || parts.includes("authenticated")) {
    return [ALL_ROLES, ADMINISTRATOR_ROLE, ...SPECIFIC_ROLES];
  }

  const normalized = normalizeRoles(parts);
  const hasAllSpecific = SPECIFIC_ROLES.every((r) => normalized.includes(r));
  if (hasAllSpecific) {
    return [ALL_ROLES, ADMINISTRATOR_ROLE, ...SPECIFIC_ROLES];
  }

  return [ADMINISTRATOR_ROLE, ...SPECIFIC_ROLES.filter((r) => normalized.includes(r))];
}

export function isPublicResource(resource: RoleRestrictedResource): boolean {
  return parseAllowedRoles(resource.allowed_roles).includes(PUBLIC_ROLE);
}

export function canAccessResource(actor: PermissionActor, resource: RoleRestrictedResource): boolean {
  if (isAdministratorRole(actor?.activeRole)) return true;
  const allowedRoles = parseAllowedRoles(resource.allowed_roles);

  // If Public, anyone (including anonymous) can access
  if (allowedRoles.includes(PUBLIC_ROLE)) return true;

  // Non-public resources strictly require authentication
  const activeRole = actor?.activeRole ? normalizeRole(actor.activeRole) : "";
  if (!activeRole) return false;

  // If accessible to all authenticated roles
  if (allowedRoles.includes(ALL_ROLES)) return true;

  // Check matching specific role
  return allowedRoles.includes(activeRole);
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
  const set = new Set(roles.map((r) => r.trim().toLowerCase()).filter(Boolean));

  // Public takes precedence if explicitly selected
  if (set.has(PUBLIC_ROLE) || set.has("all")) {
    return PUBLIC_ROLE;
  }

  // All authenticated roles
  const hasAllSpecific = SPECIFIC_ROLES.every((r) => set.has(r));
  if (set.has(ALL_ROLES) || set.has("authenticated") || hasAllSpecific) {
    return ALL_ROLES;
  }

  // Specific roles (always includes administrator)
  const specific = SPECIFIC_ROLES.filter((r) => set.has(r));
  if (specific.length === 0) {
    // When nothing else checked, it is only available for admin
    return ADMINISTRATOR_ROLE;
  }

  return [ADMINISTRATOR_ROLE, ...specific].join(",");
}
