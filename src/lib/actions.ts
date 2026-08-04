"use server";

import { client, authClient, initDb, Button, UserWithRole, Role } from "./db";
import { cookies } from "next/headers";
import {
  createPasscodeHash,
  createSessionToken,
  isSuperadminElevated,
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
} from "./permissions";

let isInitialized = false;
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

async function setSession(payload: Omit<SessionPayload, "issuedAt" | "expiresAt">): Promise<boolean> {
  const now = Date.now();
  const token = createSessionToken({
    ...payload,
    issuedAt: now,
    expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000,
  });
  if (!token) return false;
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
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
  return !!session && canManageUsers(session, isSuperadminElevated(session));
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
      return { success: false, error: "Invalid Email or NIM. User not found." };
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

    return {
      success: true,
      user: {
        name: String(userRow.name),
        email: String(userRow.email),
        role_name: normalizedRoles.join(", "),
        roles: normalizedRoles,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message || "Authentication failed." };
  }
}

export async function verifyPasscode(passcode: string): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  if (!passcode) return { success: false, error: "Passcode is required." };
  const currentSession = await readSession();
  if (!currentSession || currentSession.kind !== "user" || !isAdministratorRole(currentSession.activeRole)) {
    return { success: false, error: "An Administrator user session is required." };
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
    });
    if (!sessionCreated) return { success: false, error: "Server session secret is missing or too short." };
    return { success: true };
  }

  return { success: false, error: "Invalid Superadmin Passcode." };
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
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<{ name: string; email: string; roles: string[]; activeRole: string } | null> {
  const session = await readSession();
  if (!session || session.kind !== "user" || !session.email || !session.name) return null;
  return { name: session.name, email: session.email, roles: session.roles, activeRole: session.activeRole };
}

export async function isSuperadminSessionValid(): Promise<boolean> {
  const session = await readSession();
  return !!session && isSuperadminElevated(session);
}

export async function switchActiveRole(role: string): Promise<{ success: boolean; error?: string; activeRole?: string }> {
  const session = await readSession();
  if (!session || session.kind !== "user") return { success: false, error: "Unauthorized" };
  const requested = normalizeRole(role);
  if (!canSwitchToRole(session.roles, requested)) return { success: false, error: "Role is not assigned to this user." };
  const saved = await setSession({ ...session, activeRole: requested });
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
    return res.rows.map((row: any) => {
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
    return res.rows.map((row: any) => ({
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
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to create user." };
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
    await authClient.execute({
      sql: `UPDATE users SET email = ?, nim = ?, name = ? WHERE id = ?`,
      args: [data.email.trim().toLowerCase(), data.nim.trim(), data.name.trim(), id],
    });
    await authClient.execute({
      sql: `DELETE FROM user_roles WHERE user_id = ?`,
      args: [id],
    });
    const targetRoleIds = data.role_ids && data.role_ids.length > 0 ? data.role_ids : [2];
    for (const rId of targetRoleIds) {
      await authClient.execute({
        sql: `INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`,
        args: [id, rId],
      });
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to update user." };
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
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to delete user." };
  }
}

// ── Helper ────────────────────────────────────────────────────
function rowToButton(row: any): Button {
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
    await client.execute({
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
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
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
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
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
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
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
  } catch (error: any) {
    return { success: false, error: error.message };
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
  } catch (error: any) {
    return { success: false, error: error.message };
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
    return favRes.rows.map((row: any) => Number(row.button_id));
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
  } catch (error: any) {
    return { success: false, isFavorite: false, error: error.message || "Failed to toggle favorite" };
  }
}
