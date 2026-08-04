"use server";

import { client, authClient, initDb, Button, UserWithRole, Role } from "./db";
import { cookies } from "next/headers";
import crypto from "crypto";

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
export async function checkSession(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("gat_session")?.value;
    return !!session;
  } catch {
    return false;
  }
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
    const primaryRole = roleNames[0] || "student";
    const cookieStore = await cookies();
    const serverSecret = process.env.JWT_SECRET || "gat-secret-key-129847192";
    const sessionToken = crypto
      .createHmac("sha256", serverSecret)
      .update(`user-${userRow.id}-${userRow.email}-${primaryRole}`)
      .digest("hex");

    cookieStore.set("gat_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8, // 8 hours
      sameSite: "lax",
    });

    return {
      success: true,
      user: {
        name: String(userRow.name),
        email: String(userRow.email),
        role_name: roleNames.join(", "),
        roles: roleNames,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message || "Authentication failed." };
  }
}

export async function verifyPasscode(passcode: string): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  if (!passcode) return { success: false, error: "Passcode is required." };

  // Fetch stored passcode hash from DB settings
  const dbHash = await getSetting("superadmin_passcode_hash");

  let targetHashBuf: Buffer | null = null;

  if (dbHash && dbHash.trim()) {
    targetHashBuf = Buffer.from(dbHash.trim(), "hex");
  } else if (process.env.SUPERADMIN_PASSCODE_HASH) {
    targetHashBuf = Buffer.from(process.env.SUPERADMIN_PASSCODE_HASH.trim(), "hex");
  } else {
    // Fallback to plain text passcode env / default for initial setup
    const plainCorrect = process.env.SUPERADMIN_PASSCODE || process.env.SETTINGS_PASSCODE || "1234";
    targetHashBuf = crypto.createHash("sha256").update(plainCorrect).digest();
  }

  if (!targetHashBuf || targetHashBuf.length === 0) {
    console.warn("Superadmin login rejected: No passcode hash configured.");
    return { success: false, error: "Superadmin access disabled. Passcode not configured." };
  }

  const inputHashBuf = crypto.createHash("sha256").update(passcode).digest();

  const isMatch =
    inputHashBuf.length === targetHashBuf.length &&
    crypto.timingSafeEqual(inputHashBuf, targetHashBuf);

  if (isMatch) {
    const cookieStore = await cookies();
    const serverSecret = process.env.JWT_SECRET || "gat-secret-key-129847192";
    const sessionToken = crypto
      .createHmac("sha256", serverSecret)
      .update(`superadmin-session`)
      .digest("hex");

    cookieStore.set("gat_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8, // 8 hours
      sameSite: "lax",
    });

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

  if (newPasscode.length < 4) {
    return { success: false, error: "New passcode must be at least 4 characters long." };
  }

  const verifyRes = await verifyPasscode(currentPasscode);
  if (!verifyRes.success) {
    return { success: false, error: "Current passcode verification failed: " + (verifyRes.error || "Invalid passcode") };
  }

  const newHashHex = crypto.createHash("sha256").update(newPasscode).digest("hex");
  const saveRes = await updateSetting("", "superadmin_passcode_hash", newHashHex);

  if (!saveRes.success) {
    return { success: false, error: saveRes.error || "Failed to update passcode." };
  }

  return { success: true };
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("gat_session");
}

export async function isSessionValid(): Promise<boolean> {
  return await checkSession();
}

// ── Users & Roles Management (Central Auth DB) ───────────────
export async function getUsers(): Promise<UserWithRole[]> {
  await ensureDb();
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
  if (!(await checkSession())) return { success: false, error: "Unauthorized" };
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
  if (!(await checkSession())) return { success: false, error: "Unauthorized" };
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
  if (!(await checkSession())) return { success: false, error: "Unauthorized" };
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
    return result.rows.map(rowToButton);
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
  data: {
    button_name: string;
    source_type: "link" | "embed" | "code";
    source: string;
    icon: string;
    image_url?: string;
    category?: string;
    allowed_roles?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  const isAuthorized = (await checkSession()) || (passcode ? (await verifyPasscode(passcode)).success : false);
  if (!isAuthorized)
    return { success: false, error: "Unauthorized" };

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
  data: {
    button_name: string;
    source_type: "link" | "embed" | "code";
    source: string;
    icon: string;
    image_url?: string;
    category?: string;
    allowed_roles?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  const isAuthorized = (await checkSession()) || (passcode ? (await verifyPasscode(passcode)).success : false);
  if (!isAuthorized)
    return { success: false, error: "Unauthorized" };

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
  const isAuthorized = (await checkSession()) || (passcode ? (await verifyPasscode(passcode)).success : false);
  if (!isAuthorized)
    return { success: false, error: "Unauthorized" };

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
  const isAuthorized = (await checkSession()) || (passcode ? (await verifyPasscode(passcode)).success : false);
  if (!isAuthorized)
    return { success: false, error: "Unauthorized" };


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
  const isAuthorized = (await checkSession()) || (passcode ? (await verifyPasscode(passcode)).success : false);
  if (!isAuthorized)
    return { success: false, error: "Unauthorized" };
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
  if (!userEmail) return [];
  try {
    const userRes = await authClient.execute({
      sql: "SELECT id FROM users WHERE LOWER(email) = ?",
      args: [userEmail.trim().toLowerCase()],
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
  if (!userEmail || !buttonId) return { success: false, isFavorite: false, error: "Missing parameter" };
  try {
    const userRes = await authClient.execute({
      sql: "SELECT id FROM users WHERE LOWER(email) = ?",
      args: [userEmail.trim().toLowerCase()],
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
