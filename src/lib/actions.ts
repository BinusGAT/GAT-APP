"use server";

import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";
import { client, authClient, initDb, Button, UserWithRole, Role } from "./db";
import { cookies } from "next/headers";
import {
  createPasscodeHash,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  SUPERADMIN_ELEVATION_SECONDS,
  SessionPayload,
  verifyPasscodeHash,
  verifySessionToken,
} from "./security";
import {
  canAccessResource,
  canManageButtons,
  canManageUsers,
  canSwitchToRole,
  isAdministratorRole,
  normalizeRole,
  normalizeRoles,
  ROLE_OPTIONS,
  serializeAllowedRoles,
} from "./permissions";
import {
  LOGIN_ACCOUNT_POLICY,
  LOGIN_IP_POLICY,
  SUPERADMIN_ACCOUNT_POLICY,
  SUPERADMIN_IP_POLICY,
  createRateLimitKey,
  formatLockMessage,
  getClientIpHash,
  getLockRemainingMs,
  recordFailure,
  resetRateLimit,
} from "./rate-limit";

let isInitialized = false;
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function ensureDb() {
  if (!isInitialized) {
    try {
      await initDb();
      isInitialized = true;
    } catch (e) {
      console.error("Error in ensureDb:", e);
    }
  }
}

// ── Secure Session Helpers ─────────────────────────────────────
async function readSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
}

const SENSITIVE_AUDIT_KEY = /pass(word|code)?|secret|token|cookie|authorization|jwt|nim/i;

function sanitizeAuditDetails(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 300);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeAuditDetails(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([key, item]) => [
      key.slice(0, 80), SENSITIVE_AUDIT_KEY.test(key) ? "[redacted]" : sanitizeAuditDetails(item, depth + 1),
    ]));
  }
  return String(value).slice(0, 300);
}

async function writeAudit(
  action: string,
  targetType: string,
  targetId?: string | number,
  details?: Record<string, unknown>,
  actor?: SessionPayload | null
): Promise<void> {
  try {
    const session = actor === undefined ? await readSession() : actor;
    await client.execute({
      sql: `INSERT INTO audit_logs (actor_user_id, actor_email, action, target_type, target_id, details)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        session?.userId || null,
        session?.email || null,
        action,
        targetType,
        targetId === undefined ? null : String(targetId),
        details ? JSON.stringify(sanitizeAuditDetails(details)) : null,
      ],
    });
  } catch (error) {
    console.error("Failed to write audit log:", error);
  }
}

async function setSession(
  payload: Omit<SessionPayload, "issuedAt" | "expiresAt">,
  absoluteExpiresAt?: number
): Promise<boolean> {
  const now = Date.now();
  const expiresAt = absoluteExpiresAt ?? now + SESSION_MAX_AGE_SECONDS * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const token = createSessionToken({
    ...payload,
    issuedAt: now,
    expiresAt,
  });
  if (!token) return false;
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.ceil((expiresAt - now) / 1000),
    sameSite: "strict",
  });
  return true;
}

export async function checkSession(): Promise<boolean> {
  return (await readSession()) !== null;
}

async function requireAdministrator(): Promise<boolean> {
  const session = await readSession();
  return !!session && canManageButtons(session);
}

async function requireSuperadmin(): Promise<boolean> {
  const session = await readSession();
  return canManageUsers(session);
}

// ── Auth (Email & NIM with Role Validation) ─────────────────────
export async function verifyUserCredentials(
  email: string,
  nim: string
): Promise<{ success: boolean; error?: string; user?: { name: string; email: string; role_name: string; roles?: string[] } }> {
  await ensureDb();
  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanNim = nim.trim();

    if (!cleanEmail || !cleanNim) {
      return { success: false, error: "Both Email and NIM are required." };
    }

    const ipHash = await getClientIpHash();
    const accountKey = createRateLimitKey("login-account-ip", `${cleanEmail}:${ipHash || ""}`);
    const ipKey = createRateLimitKey("login-ip", ipHash || "");
    if (!ipHash || !accountKey || !ipKey) {
      return { success: false, error: "Authentication service is not configured securely." };
    }

    const lockRemaining = await getLockRemainingMs([accountKey, ipKey]);
    if (lockRemaining > 0) {
      return { success: false, error: formatLockMessage(lockRemaining) };
    }

    const res = await authClient.execute({
      sql: `
        SELECT 
          u.id, 
          u.email, 
          u.nim, 
          u.name, 
          GROUP_CONCAT(COALESCE(r.name, 'student')) AS role_names_str
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE LOWER(u.email) = ? AND u.nim = ?
        GROUP BY u.id
      `,
      args: [cleanEmail, cleanNim],
    });

    if (res.rows.length === 0) {
      await Promise.all([
        recordFailure(accountKey, LOGIN_ACCOUNT_POLICY),
        recordFailure(ipKey, LOGIN_IP_POLICY),
      ]);
      const newLockRemaining = await getLockRemainingMs([accountKey, ipKey]);
      return {
        success: false,
        error: newLockRemaining > 0
          ? formatLockMessage(newLockRemaining)
          : "Invalid Email or NIM.",
      };
    }

    const userRow = res.rows[0];
    const roleNamesStr = String(userRow.role_names_str || "student");
    const roleNames = roleNamesStr.split(",").map((r) => r.trim());
    const normalizedRoles = normalizeRoles(roleNames);
    const primaryRole = normalizedRoles.find(isAdministratorRole) || normalizedRoles[0] || "student";
    const sessionCreated = await setSession({
      kind: "user",
      userId: Number(userRow.id),
      name: String(userRow.name),
      email: String(userRow.email),
      roles: normalizedRoles,
      activeRole: primaryRole,
    });
    if (!sessionCreated) {
      return { success: false, error: "Server session secret is missing or too short." };
    }

    await resetRateLimit(accountKey);

    return {
      success: true,
      user: {
        name: String(userRow.name),
        email: String(userRow.email),
        role_name: normalizedRoles.join(", "),
        roles: normalizedRoles,
      },
    };
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error, "Authentication failed.") };
  }
}

export async function verifyPasscode(passcode: string): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  if (!passcode) return { success: false, error: "Passcode is required." };
  const currentSession = await readSession();
  if (!currentSession || currentSession.kind !== "user" || !isAdministratorRole(currentSession.activeRole)) {
    return { success: false, error: "An Administrator user session is required." };
  }

  const ipHash = await getClientIpHash();
  const administratorId = String(currentSession.userId || currentSession.email || "unknown");
  const accountKey = createRateLimitKey("superadmin-account-ip", `${administratorId}:${ipHash || ""}`);
  const ipKey = createRateLimitKey("superadmin-ip", ipHash || "");
  if (!ipHash || !accountKey || !ipKey) {
    return { success: false, error: "Authentication service is not configured securely." };
  }

  const lockRemaining = await getLockRemainingMs([accountKey, ipKey]);
  if (lockRemaining > 0) {
    return { success: false, error: formatLockMessage(lockRemaining) };
  }

  // Fetch stored passcode hash from DB settings
  const hashResult = await client.execute({
    sql: "SELECT value FROM settings WHERE key = ?",
    args: ["superadmin_passcode_hash"],
  });
  const dbHash = hashResult.rows.length > 0 ? String(hashResult.rows[0].value) : "";

  const storedHash = dbHash?.trim() || process.env.SUPERADMIN_PASSCODE_HASH?.trim();
  if (!storedHash) {
    console.warn("Superadmin login rejected: No passcode hash configured.");
    return { success: false, error: "Superadmin access disabled. Passcode not configured." };
  }

  const verification = verifyPasscodeHash(passcode, storedHash);
  if (verification !== "invalid") {
    if (verification === "legacy") {
      await client.execute({
        sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        args: ["superadmin_passcode_hash", createPasscodeHash(passcode)],
      });
    }
    const sessionCreated = await setSession({
      ...currentSession,
      superadminUntil: Date.now() + SUPERADMIN_ELEVATION_SECONDS * 1000,
    }, currentSession.expiresAt);
    if (!sessionCreated) return { success: false, error: "Server session secret is missing or too short." };
    await resetRateLimit(accountKey);
    return { success: true };
  }

  await Promise.all([
    recordFailure(accountKey, SUPERADMIN_ACCOUNT_POLICY),
    recordFailure(ipKey, SUPERADMIN_IP_POLICY),
  ]);
  const newLockRemaining = await getLockRemainingMs([accountKey, ipKey]);
  return {
    success: false,
    error: newLockRemaining > 0
      ? formatLockMessage(newLockRemaining)
      : "Invalid Superadmin Passcode.",
  };
}

export async function updateSuperadminPasscode(
  currentPasscode: string,
  newPasscode: string
): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  if (!currentPasscode || !newPasscode) {
    return { success: false, error: "Both current and new passcodes are required." };
  }

  if (newPasscode.length < 5) {
    return { success: false, error: "New passcode must be at least 5 characters long." };
  }

  const verifyRes = await verifyPasscode(currentPasscode);
  if (!verifyRes.success) {
    return { success: false, error: "Current passcode verification failed: " + (verifyRes.error || "Invalid passcode") };
  }

  const newHashHex = createPasscodeHash(newPasscode);
  const saveRes = await updateSetting("", "superadmin_passcode_hash", newHashHex);

  if (!saveRes.success) {
    return { success: false, error: saveRes.error || "Failed to update passcode." };
  }

  return { success: true };
}

export async function logout(): Promise<void> {
  await ensureDb();
  await writeAudit("user.logout", "session");
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function exitSuperadmin(): Promise<{ success: boolean; error?: string }> {
  const currentSession = await readSession();
  if (!currentSession || currentSession.kind !== "user") {
    return { success: false, error: "User session is no longer valid." };
  }

  const userSession = { ...currentSession, superadminUntil: undefined };
  const saved = await setSession(userSession, currentSession.expiresAt);
  return saved
    ? { success: true }
    : { success: false, error: "Unable to exit Superadmin mode." };
}

export async function getCurrentUser(): Promise<{ name: string; email: string; roles: string[]; activeRole: string } | null> {
  const session = await readSession();
  if (!session || session.kind !== "user" || !session.email || !session.name) return null;
  return { name: session.name, email: session.email, roles: session.roles, activeRole: session.activeRole };
}

export async function isSuperadminSessionValid(): Promise<boolean> {
  const session = await readSession();
  return canManageUsers(session);
}

export async function switchActiveRole(role: string): Promise<{ success: boolean; error?: string; activeRole?: string }> {
  const session = await readSession();
  if (!session || session.kind !== "user") return { success: false, error: "Unauthorized" };
  const requested = normalizeRole(role);
  if (!canSwitchToRole(session.roles, requested)) return { success: false, error: "Role is not assigned to this user." };
  const saved = await setSession({ ...session, activeRole: requested }, session.expiresAt);
  return saved ? { success: true, activeRole: requested } : { success: false, error: "Unable to update session." };
}

export async function isSessionValid(): Promise<boolean> {
  return await checkSession();
}

// ── Users & Roles Management (Central Auth DB) ───────────────
export async function getUsers(): Promise<UserWithRole[]> {
  await ensureDb();
  if (!(await requireSuperadmin())) return [];
  try {
    const res = await authClient.execute(`
      SELECT 
        u.id, 
        u.email, 
        u.nim, 
        u.name, 
        GROUP_CONCAT(COALESCE(ur.role_id, 2)) AS role_ids_str, 
        GROUP_CONCAT(COALESCE(r.name, 'student')) AS role_names_str
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON r.id = ur.role_id
      GROUP BY u.id
      ORDER BY u.id ASC
    `);
    return res.rows.map((row) => {
      const roleIdsStr = String(row.role_ids_str || "2");
      const roleNamesStr = String(row.role_names_str || "student");
      const role_ids = roleIdsStr.split(",").map((id) => Number(id.trim())).filter((n) => !isNaN(n));
      const role_names = roleNamesStr.split(",").map((n) => n.trim());
      return {
        id: Number(row.id),
        email: String(row.email),
        nim: row.nim ? String(row.nim) : null,
        name: String(row.name),
        role_id: role_ids[0] || 2,
        role_name: role_names.join(", "),
        role_ids: role_ids.length > 0 ? role_ids : [2],
        role_names: role_names.length > 0 ? role_names : ["student"],
        created_at: "",
        updated_at: "",
      };
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    return [];
  }
}

export async function getRoles(): Promise<Role[]> {
  await ensureDb();
  if (!(await requireSuperadmin())) return [];
  try {
    const res = await authClient.execute(`SELECT id, name FROM roles ORDER BY id ASC`);
    return res.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      description: "",
      created_at: "",
    }));
  } catch (error) {
    console.error("Error fetching roles:", error);
    return [];
  }
}

export async function createUser(data: { email: string; nim: string; name: string; role_ids: number[] }): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  if (!(await requireSuperadmin())) return { success: false, error: "Unauthorized" };
  if (!data.email?.trim() || !data.nim?.trim() || !data.name?.trim()) return { success: false, error: "Email, NIM, and name are required." };
  if (!/^\S+@\S+\.\S+$/.test(data.email.trim()) || !Array.isArray(data.role_ids) || data.role_ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return { success: false, error: "Invalid user data." };
  }
  try {
    const userRes = await authClient.execute({
      sql: `INSERT INTO users (email, nim, name) VALUES (?, ?, ?)`,
      args: [data.email.trim().toLowerCase(), data.nim.trim(), data.name.trim()],
    });
    const newUserId = Number(userRes.lastInsertRowid);
    if (newUserId) {
      const targetRoleIds = data.role_ids && data.role_ids.length > 0 ? data.role_ids : [2];
      for (const rId of targetRoleIds) {
        await authClient.execute({
          sql: `INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`,
          args: [newUserId, rId],
        });
      }
    }
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error, "Failed to create user.") };
  }
}

export async function updateUser(id: number, data: { email: string; nim: string; name: string; role_ids: number[] }): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  if (!(await requireSuperadmin())) return { success: false, error: "Unauthorized" };
  if (!Number.isInteger(id) || id <= 0 || !data.email?.trim() || !data.nim?.trim() || !data.name?.trim()) return { success: false, error: "Invalid user data." };
  if (!/^\S+@\S+\.\S+$/.test(data.email.trim()) || !Array.isArray(data.role_ids) || data.role_ids.some((roleId) => !Number.isInteger(roleId) || roleId <= 0)) {
    return { success: false, error: "Invalid user data." };
  }
  try {
    const previousResult = await authClient.execute({
      sql: `SELECT u.email, u.name, GROUP_CONCAT(r.name) AS role_names
            FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
            WHERE u.id=? GROUP BY u.id`,
      args: [id],
    });
    if (previousResult.rows.length === 0) return { success: false, error: "User not found." };
    const previous = previousResult.rows[0];
    const targetRoleIds = data.role_ids.length > 0 ? data.role_ids : [2];
    const roleResult = await authClient.execute({
      sql: `SELECT name FROM roles WHERE id IN (${targetRoleIds.map(() => "?").join(",")}) ORDER BY id`,
      args: targetRoleIds,
    });
    const oldRoles = String(previous.role_names || "student").split(",").map((role) => role.trim()).sort();
    const newRoles = roleResult.rows.map((row) => String(row.name)).sort();
    await authClient.execute({
      sql: `UPDATE users SET email = ?, nim = ?, name = ? WHERE id = ?`,
      args: [data.email.trim().toLowerCase(), data.nim.trim(), data.name.trim(), id],
    });
    await authClient.execute({
      sql: `DELETE FROM user_roles WHERE user_id = ?`,
      args: [id],
    });
    for (const rId of targetRoleIds) {
      await authClient.execute({
        sql: `INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`,
        args: [id, rId],
        });
    }
    const changes: Array<{ field: string; from: string; to: string }> = [];
    const nextEmail = data.email.trim().toLowerCase();
    const nextName = data.name.trim();
    if (String(previous.email) !== nextEmail) changes.push({ field: "Email", from: String(previous.email), to: nextEmail });
    if (String(previous.name) !== nextName) changes.push({ field: "Name", from: String(previous.name), to: nextName });
    if (oldRoles.join(",") !== newRoles.join(",")) changes.push({ field: "Permissions", from: oldRoles.join(", "), to: newRoles.join(", ") });
    await writeAudit("user.updated", "user", id, { changes });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error, "Failed to update user.") };
  }
}

export async function deleteUser(id: number): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  if (!(await requireSuperadmin())) return { success: false, error: "Unauthorized" };
  if (!Number.isInteger(id) || id <= 0) return { success: false, error: "Invalid user ID." };
  try {
    await authClient.execute({
      sql: `DELETE FROM user_roles WHERE user_id = ?`,
      args: [id],
    });
    await authClient.execute({
      sql: `DELETE FROM users WHERE id = ?`,
      args: [id],
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error, "Failed to delete user.") };
  }
}

// ── Helper ────────────────────────────────────────────────────
function rowToButton(row: Record<string, unknown>): Button {
  return {
    id: Number(row.id),
    button_name: String(row.button_name),
    source_type: row.source_type as "link" | "embed" | "code",
    source: String(row.source),
    icon: String(row.icon ?? "Cube"),
    image_url: row.image_url ? String(row.image_url) : null,
    category: row.category ? String(row.category) : "apps",
    allowed_roles: row.allowed_roles ? String(row.allowed_roles) : "all",
    order: Number(row.order ?? 0),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

type ButtonInput = {
  button_name: string;
  source_type: "link" | "embed" | "code";
  source: string;
  icon: string;
  image_url?: string;
  category?: string;
  allowed_roles?: string;
};

function validateButtonInput(data: ButtonInput): string | null {
  if (!data || !data.button_name?.trim() || !data.source?.trim() || !data.icon?.trim()) return "Name, source, and icon are required.";
  if (!["link", "embed", "code"].includes(data.source_type)) return "Invalid source type.";
  if (data.button_name.length > 120 || data.source.length > 100_000 || data.icon.length > 80) return "Button data exceeds the allowed length.";
  if (data.allowed_roles && !/^(all|[a-z]+(?:,[a-z]+)*)$/i.test(data.allowed_roles.trim())) return "Invalid role permissions.";
  return null;
}

// ── Public ────────────────────────────────────────────────────
/**
 * Returns all buttons ordered by `order` ascending.
 */
export async function getButtons(): Promise<Button[]> {
  await ensureDb();
  try {
    const result = await client.execute(
      `SELECT * FROM buttons ORDER BY "order" ASC, id ASC`
    );
    const buttons = result.rows.map(rowToButton);
    const session = await readSession();
    return buttons.filter((button) => canAccessResource(session, button));
  } catch (error) {
    console.error("Error in getButtons:", error);
    return [];
  }
}

// ── Admin CRUD ────────────────────────────────────────────────
/**
 * Adds a new button. Requires active session.
 */
export async function addButton(
  passcode: string,
  data: ButtonInput
): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  void passcode;
  if (!(await requireAdministrator())) return { success: false, error: "Unauthorized" };
  const validationError = validateButtonInput(data);
  if (validationError) return { success: false, error: validationError };

  try {
    const res = await client.execute(
      `SELECT MAX("order") as max_order FROM buttons`
    );
    const maxOrder = Number(res.rows[0]?.max_order ?? -1);
    const insertResult = await client.execute({
      sql: `INSERT INTO buttons (button_name, source_type, source, icon, image_url, category, allowed_roles, "order")
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        data.button_name,
        data.source_type,
        data.source,
        data.icon,
        data.image_url?.trim() || null,
        data.category?.trim() || "apps",
        data.allowed_roles?.trim() || "all",
        maxOrder + 1,
      ],
    });
    await writeAudit("button.created", "button", Number(insertResult.lastInsertRowid), { name: data.button_name });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error, "Failed to add button.") };
  }
}

/**
 * Updates an existing button. Requires active session.
 */
export async function updateButton(
  passcode: string,
  id: number,
  data: ButtonInput
): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  void passcode;
  if (!(await requireAdministrator())) return { success: false, error: "Unauthorized" };
  if (!Number.isInteger(id) || id <= 0) return { success: false, error: "Invalid button ID." };
  const validationError = validateButtonInput(data);
  if (validationError) return { success: false, error: validationError };

  try {
    await client.execute({
      sql: `UPDATE buttons
            SET button_name = ?, source_type = ?, source = ?, icon = ?, image_url = ?, category = ?, allowed_roles = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      args: [
        data.button_name,
        data.source_type,
        data.source,
        data.icon,
        data.image_url?.trim() || null,
        data.category?.trim() || "apps",
        data.allowed_roles?.trim() || "all",
        id,
      ],
    });
    await writeAudit("button.updated", "button", id, { name: data.button_name });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error, "Failed to update button.") };
  }
}

/**
 * Deletes a button by ID. Requires active session.
 */
export async function deleteButton(
  passcode: string,
  id: number
): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  void passcode;
  if (!(await requireAdministrator())) return { success: false, error: "Unauthorized" };
  if (!Number.isInteger(id) || id <= 0) return { success: false, error: "Invalid button ID." };

  try {
    await client.execute({ sql: `DELETE FROM buttons WHERE id = ?`, args: [id] });
    await writeAudit("button.deleted", "button", id);
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error, "Failed to delete button.") };
  }
}

/**
 * Reorders buttons by updating the `order` column. Requires active session.
 */
export async function reorderButtons(
  passcode: string,
  orderedIds: number[]
): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  void passcode;
  if (!(await requireAdministrator())) return { success: false, error: "Unauthorized" };
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => !Number.isInteger(id) || id <= 0) || new Set(orderedIds).size !== orderedIds.length) {
    return { success: false, error: "Invalid button order." };
  }


  try {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.execute({
        sql: `UPDATE buttons SET "order" = ? WHERE id = ?`,
        args: [i, orderedIds[i]],
      });
    }
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error, "Failed to reorder buttons.") };
  }
}

// ── Settings ──────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string> {
  await ensureDb();
  if (!(await requireAdministrator())) return "";
  try {
    const result = await client.execute({
      sql: "SELECT value FROM settings WHERE key = ?",
      args: [key],
    });
    return result.rows.length > 0 ? String(result.rows[0].value) : "";
  } catch {
    return "";
  }
}

export async function getHomeSettings(): Promise<{ type: string; value: string }> {
  await ensureDb();
  try {
    const result = await client.execute(
      "SELECT key, value FROM settings WHERE key IN ('home_content_type', 'home_content_value')"
    );
    let type = "";
    let value = "";
    for (const row of result.rows) {
      if (row.key === "home_content_type") type = String(row.value);
      if (row.key === "home_content_value") value = String(row.value);
    }
    return { type, value };
  } catch {
    return { type: "", value: "" };
  }
}

export async function updateSetting(
  passcode: string,
  key: string,
  value: string
): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  void passcode;
  if (!(await requireAdministrator())) return { success: false, error: "Unauthorized" };
  if (!/^[a-z0-9_]{1,80}$/i.test(key) || value.length > 1_000_000) return { success: false, error: "Invalid setting." };
  try {
    await client.execute({
      sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      args: [key, value],
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error, "Failed to update setting.") };
  }
}

// ── User Favorites Actions ──────────────────────────────────
export async function getUserFavorites(userEmail: string): Promise<number[]> {
  await ensureDb();
  const session = await readSession();
  if (!session || session.kind !== "user" || !session.email) return [];
  const sessionEmail = session.email.trim().toLowerCase();
  if (userEmail && userEmail.trim().toLowerCase() !== sessionEmail) return [];
  try {
    const userRes = await authClient.execute({
      sql: "SELECT id FROM users WHERE LOWER(email) = ?",
      args: [sessionEmail],
    });
    if (userRes.rows.length === 0) return [];
    const userId = Number(userRes.rows[0].id);

    const favRes = await client.execute({
      sql: "SELECT button_id FROM user_favorites WHERE user_id = ?",
      args: [userId],
    });
    return favRes.rows.map((row) => Number(row.button_id));
  } catch (error) {
    console.error("Error in getUserFavorites:", error);
    return [];
  }
}

export async function toggleUserFavorite(
  userEmail: string,
  buttonId: number
): Promise<{ success: boolean; isFavorite: boolean; error?: string }> {
  await ensureDb();
  const session = await readSession();
  if (!session || session.kind !== "user" || !session.email) return { success: false, isFavorite: false, error: "Unauthorized" };
  const sessionEmail = session.email.trim().toLowerCase();
  if ((userEmail && userEmail.trim().toLowerCase() !== sessionEmail) || !Number.isInteger(buttonId) || buttonId <= 0) {
    return { success: false, isFavorite: false, error: "Invalid parameter" };
  }
  try {
    const userRes = await authClient.execute({
      sql: "SELECT id FROM users WHERE LOWER(email) = ?",
      args: [sessionEmail],
    });
    if (userRes.rows.length === 0) return { success: false, isFavorite: false, error: "User not found" };
    const userId = Number(userRes.rows[0].id);

    const checkRes = await client.execute({
      sql: "SELECT 1 FROM user_favorites WHERE user_id = ? AND button_id = ?",
      args: [userId, buttonId],
    });

    const isFav = checkRes.rows.length > 0;
    if (isFav) {
      await client.execute({
        sql: "DELETE FROM user_favorites WHERE user_id = ? AND button_id = ?",
        args: [userId, buttonId],
      });
      return { success: true, isFavorite: false };
    } else {
      await client.execute({
        sql: "INSERT OR IGNORE INTO user_favorites (user_id, button_id) VALUES (?, ?)",
        args: [userId, buttonId],
      });
      return { success: true, isFavorite: true };
    }
  } catch (error: unknown) {
    return { success: false, isFavorite: false, error: errorMessage(error, "Failed to toggle favorite") };
  }
}

// ── Portal Operations & Observability ───────────────────────
export type Announcement = {
  id: number; title: string; message: string; severity: "info" | "warning" | "critical";
  is_active: boolean; starts_at: number | null; ends_at: number | null; target_roles: string; created_at: string;
};

export async function getActiveAnnouncements(): Promise<Announcement[]> {
  await ensureDb();
  const session = await readSession();
  const now = Date.now();
  const result = await client.execute({
    sql: `SELECT * FROM announcements WHERE is_active = 1
          AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
          ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC`,
    args: [now, now],
  });
  return result.rows.map((row) => ({
    id: Number(row.id), title: String(row.title), message: String(row.message),
    severity: row.severity as Announcement["severity"], is_active: Boolean(row.is_active),
    starts_at: row.starts_at == null ? null : Number(row.starts_at),
    ends_at: row.ends_at == null ? null : Number(row.ends_at), target_roles: String(row.target_roles || "all"), created_at: String(row.created_at),
  })).filter((announcement) => canAccessResource(session, { allowed_roles: announcement.target_roles }));
}

export async function getAnnouncements(): Promise<Announcement[]> {
  await ensureDb();
  if (!(await requireAdministrator())) return [];
  const result = await client.execute("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 100");
  return result.rows.map((row) => ({
    id: Number(row.id), title: String(row.title), message: String(row.message),
    severity: row.severity as Announcement["severity"], is_active: Boolean(row.is_active),
    starts_at: row.starts_at == null ? null : Number(row.starts_at),
    ends_at: row.ends_at == null ? null : Number(row.ends_at), target_roles: String(row.target_roles || "all"), created_at: String(row.created_at),
  }));
}

export async function saveAnnouncement(data: {
  id?: number; title: string; message: string; severity: Announcement["severity"]; isActive: boolean;
  startsAt?: number | null; endsAt?: number | null; targetRoles?: string[];
}): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  if (!(await requireAdministrator())) return { success: false, error: "Unauthorized" };
  const title = data.title?.trim();
  const message = data.message?.trim();
  if (!title || !message || title.length > 160 || message.length > 2000 || !["info", "warning", "critical"].includes(data.severity)) {
    return { success: false, error: "Invalid announcement." };
  }
  const startsAt = data.startsAt && Number.isFinite(data.startsAt) ? data.startsAt : null;
  const endsAt = data.endsAt && Number.isFinite(data.endsAt) ? data.endsAt : null;
  if (startsAt && endsAt && endsAt <= startsAt) return { success: false, error: "End time must be after start time." };
  const requestedRoles = normalizeRoles(data.targetRoles || ["all"]);
  const validRoles = new Set<string>(ROLE_OPTIONS.map((role) => role.id));
  if (requestedRoles.some((role) => !validRoles.has(role))) {
    return { success: false, error: "Invalid announcement audience." };
  }
  const targetRoles = serializeAllowedRoles(requestedRoles);
  const session = await readSession();
  if (data.id) {
    await client.execute({
      sql: `UPDATE announcements SET title=?, message=?, severity=?, is_active=?, starts_at=?, ends_at=?, target_roles=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      args: [title, message, data.severity, data.isActive ? 1 : 0, startsAt, endsAt, targetRoles, data.id],
    });
    await writeAudit("announcement.updated", "announcement", data.id, { title });
  } else {
    const result = await client.execute({
      sql: `INSERT INTO announcements (title, message, severity, is_active, starts_at, ends_at, target_roles, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [title, message, data.severity, data.isActive ? 1 : 0, startsAt, endsAt, targetRoles, session?.userId || null],
    });
    await writeAudit("announcement.created", "announcement", Number(result.lastInsertRowid), { title });
  }
  return { success: true };
}

export async function deleteAnnouncement(id: number): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  if (!(await requireAdministrator())) return { success: false, error: "Unauthorized" };
  if (!Number.isInteger(id) || id <= 0) return { success: false, error: "Invalid announcement." };
  await client.execute({ sql: "DELETE FROM announcements WHERE id=?", args: [id] });
  await writeAudit("announcement.deleted", "announcement", id);
  return { success: true };
}

export async function recordApplicationOpen(buttonId: number): Promise<void> {
  await ensureDb();
  if (!Number.isInteger(buttonId) || buttonId <= 0) return;
  const session = await readSession();
  const buttonResult = await client.execute({ sql: "SELECT * FROM buttons WHERE id=?", args: [buttonId] });
  if (buttonResult.rows.length === 0 || !canAccessResource(session, rowToButton(buttonResult.rows[0]))) return;
  await client.execute({
    sql: "INSERT INTO app_usage (user_id, button_id) VALUES (?, ?)",
    args: [session?.userId || null, buttonId],
  });
}

export async function getAuditLogs(): Promise<Array<Record<string, string | number | null>>> {
  await ensureDb();
  if (!(await requireAdministrator())) return [];
  const result = await client.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200");
  return result.rows.map((row) => {
    let details: string | null = null;
    if (row.details) {
      try { details = JSON.stringify(sanitizeAuditDetails(JSON.parse(String(row.details)))); }
      catch { details = JSON.stringify({ summary: sanitizeAuditDetails(String(row.details)) }); }
    }
    return {
    id: Number(row.id), actor_email: row.actor_email ? String(row.actor_email) : null,
    action: String(row.action),
    details, created_at: String(row.created_at),
    };
  });
}

export async function getUsageAnalytics(): Promise<{
  totalLaunches: number; uniqueUsers: number; topApps: Array<{ name: string; launches: number }>;
}> {
  await ensureDb();
  if (!(await requireAdministrator())) return { totalLaunches: 0, uniqueUsers: 0, topApps: [] };
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [summary, top] = await Promise.all([
    client.execute({ sql: "SELECT COUNT(*) total, COUNT(DISTINCT user_id) users FROM app_usage WHERE opened_at >= ?", args: [since] }),
    client.execute({ sql: `SELECT b.button_name name, COUNT(*) launches FROM app_usage u JOIN buttons b ON b.id=u.button_id
                           WHERE u.opened_at >= ? GROUP BY b.id ORDER BY launches DESC LIMIT 10`, args: [since] }),
  ]);
  return {
    totalLaunches: Number(summary.rows[0]?.total || 0), uniqueUsers: Number(summary.rows[0]?.users || 0),
    topApps: top.rows.map((row) => ({ name: String(row.name), launches: Number(row.launches) })),
  };
}

// ── Consolidated Bootstrap Action ─────────────────────────────
export interface AppBootstrapData {
  user: { name: string; email: string; roles: string[]; activeRole: string } | null;
  buttons: Button[];
  homeSettings: { type: string; value: string };
  favorites: number[];
  announcements: Announcement[];
}

export async function getAppBootstrapData(): Promise<AppBootstrapData> {
  await ensureDb();
  try {
    const session = await readSession();
    const user =
      session && session.kind === "user" && session.email && session.name
        ? { name: session.name, email: session.email, roles: session.roles, activeRole: session.activeRole }
        : null;

    const now = Date.now();

    const [buttonsResult, settingsResult, announcementsResult, favoritesResult] = await Promise.all([
      client.execute(`SELECT * FROM buttons ORDER BY "order" ASC, id ASC`),
      client.execute("SELECT key, value FROM settings WHERE key IN ('home_content_type', 'home_content_value')"),
      client.execute({
        sql: `SELECT * FROM announcements WHERE is_active = 1
              AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
              ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC`,
        args: [now, now],
      }),
      (async () => {
        if (!user || !user.email) return [];
        try {
          const sessionEmail = user.email.trim().toLowerCase();
          const userRes = await authClient.execute({
            sql: "SELECT id FROM users WHERE LOWER(email) = ?",
            args: [sessionEmail],
          });
          if (userRes.rows.length === 0) return [];
          const userId = Number(userRes.rows[0].id);
          const favRes = await client.execute({
            sql: "SELECT button_id FROM user_favorites WHERE user_id = ?",
            args: [userId],
          });
          return favRes.rows.map((row) => Number(row.button_id));
        } catch {
          return [];
        }
      })(),
    ]);

    const buttons = buttonsResult.rows.map(rowToButton).filter((button) => canAccessResource(session, button));

    let type = "";
    let value = "";
    for (const row of settingsResult.rows) {
      if (row.key === "home_content_type") type = String(row.value);
      if (row.key === "home_content_value") value = String(row.value);
    }

    const announcements = announcementsResult.rows
      .map((row) => ({
        id: Number(row.id),
        title: String(row.title),
        message: String(row.message),
        severity: row.severity as Announcement["severity"],
        is_active: Boolean(row.is_active),
        starts_at: row.starts_at == null ? null : Number(row.starts_at),
        ends_at: row.ends_at == null ? null : Number(row.ends_at),
        target_roles: String(row.target_roles || "all"),
        created_at: String(row.created_at),
      }))
      .filter((announcement) => canAccessResource(session, { allowed_roles: announcement.target_roles }));

    return {
      user,
      buttons,
      homeSettings: { type, value },
      favorites: favoritesResult,
      announcements,
    };
  } catch (error) {
    console.error("Error in getAppBootstrapData:", error);
    return {
      user: null,
      buttons: [],
      homeSettings: { type: "", value: "" },
      favorites: [],
      announcements: [],
    };
  }
}

function isPrivateAddress(address: string): boolean {

  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

async function safeHealthUrl(source: string): Promise<URL | null> {
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost" || url.hostname.endsWith(".local")) return null;
    const addresses = await dns.lookup(url.hostname, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address)) ? url : null;
  } catch { return null; }
}

async function performApplicationHealthCheck(buttonId: number): Promise<{ success: boolean; error?: string }> {
  const result = await client.execute({ sql: "SELECT * FROM buttons WHERE id=?", args: [buttonId] });
  if (result.rows.length === 0) return { success: false, error: "Application not found." };
  const button = rowToButton(result.rows[0]);
  const url = button.source_type === "code" ? null : await safeHealthUrl(button.source);
  let status = "unsupported", statusCode: number | null = null, latency: number | null = null, message = "Health checks require a public HTTPS URL.";
  if (url) {
    const started = Date.now();
    try {
      const response = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000), cache: "no-store" });
      latency = Date.now() - started; statusCode = response.status;
      status = response.ok ? "healthy" : response.status >= 500 ? "down" : "degraded";
      message = response.ok ? "Responding normally." : `Returned HTTP ${response.status}.`;
    } catch { latency = Date.now() - started; status = "down"; message = "Request failed or timed out."; }
  }
  await client.execute({
    sql: `INSERT INTO app_health (button_id,status,status_code,latency_ms,message,checked_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(button_id) DO UPDATE SET status=excluded.status,status_code=excluded.status_code,
          latency_ms=excluded.latency_ms,message=excluded.message,checked_at=CURRENT_TIMESTAMP`,
    args: [buttonId, status, statusCode, latency, message],
  });
  await writeAudit("health.checked", "button", buttonId, { status });
  return { success: true };
}

export async function refreshApplicationHealth(buttonId: number): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  if (!(await requireAdministrator())) return { success: false, error: "Unauthorized" };
  return performApplicationHealthCheck(buttonId);
}

export async function refreshAllApplicationHealth(): Promise<{ success: boolean; checked: number; error?: string }> {
  await ensureDb();
  if (!(await requireAdministrator())) return { success: false, checked: 0, error: "Unauthorized" };
  const result = await client.execute("SELECT id FROM buttons ORDER BY id");
  for (const row of result.rows) await performApplicationHealthCheck(Number(row.id));
  return { success: true, checked: result.rows.length };
}

export async function runScheduledHealthChecks(secret: string): Promise<{ success: boolean; checked: number; error?: string }> {
  const configured = process.env.CRON_SECRET?.trim() || "";
  const supplied = secret?.trim() || "";
  const configuredBytes = Buffer.from(configured);
  const suppliedBytes = Buffer.from(supplied);
  if (configuredBytes.length < 32 || suppliedBytes.length !== configuredBytes.length ||
      !crypto.timingSafeEqual(suppliedBytes, configuredBytes)) {
    return { success: false, checked: 0, error: "Unauthorized" };
  }
  await ensureDb();
  const result = await client.execute("SELECT id FROM buttons ORDER BY id");
  for (const row of result.rows) await performApplicationHealthCheck(Number(row.id));
  return { success: true, checked: result.rows.length };
}

export async function getApplicationHealth(): Promise<Array<Record<string, string | number | null>>> {
  await ensureDb();
  if (!(await requireAdministrator())) return [];
  const result = await client.execute(`SELECT b.id, b.button_name, b.source_type, h.status, h.status_code, h.latency_ms, h.message, h.checked_at
    FROM buttons b LEFT JOIN app_health h ON h.button_id=b.id ORDER BY b."order", b.id`);
  return result.rows.map((row) => ({ id: Number(row.id), button_name: String(row.button_name), source_type: String(row.source_type),
    status: row.status ? String(row.status) : "unknown", status_code: row.status_code == null ? null : Number(row.status_code),
    latency_ms: row.latency_ms == null ? null : Number(row.latency_ms), message: row.message ? String(row.message) : null,
    checked_at: row.checked_at ? String(row.checked_at) : null }));
}
