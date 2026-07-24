"use server";

import { client, initDb, Button, SidebarItem } from "./db";
import { cookies } from "next/headers";
import crypto from "crypto";

let isInitialized = false;
async function ensureDb() {
  if (!isInitialized) {
    await initDb();
    isInitialized = true;
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
): Promise<{ success: boolean; error?: string; user?: { name: string; email: string; role_name: string } }> {
  await ensureDb();
  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanNim = nim.trim();

    if (!cleanEmail || !cleanNim) {
      return { success: false, error: "Both Email and NIM are required." };
    }

    const res = await client.execute({
      sql: `
        SELECT 
          u.id, 
          u.email, 
          u.nim, 
          u.name, 
          r.name AS role_name 
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE LOWER(u.email) = ? AND u.nim = ?
      `,
      args: [cleanEmail, cleanNim],
    });

    if (res.rows.length === 0) {
      return { success: false, error: "Invalid Email or NIM. User not found." };
    }

    const userRow = res.rows[0];
    const roleName = String(userRow.role_name).toLowerCase();

    if (roleName === "student") {
      return {
        success: false,
        error: "Access Denied",
      };
    }

    const cookieStore = await cookies();
    const serverSecret = process.env.JWT_SECRET || "gat-secret-key-129847192";
    const sessionToken = crypto
      .createHmac("sha256", serverSecret)
      .update(`user-${userRow.id}-${userRow.email}-${roleName}`)
      .digest("hex");

    cookieStore.set("gat_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 2, // 2 hours
      sameSite: "lax",
    });

    return {
      success: true,
      user: {
        name: String(userRow.name),
        email: String(userRow.email),
        role_name: String(userRow.role_name),
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message || "Authentication failed." };
  }
}

// Kept for backward compatibility
export async function verifyPasscode(passcode: string): Promise<boolean> {
  if (!passcode) return false;
  const correct = process.env.SETTINGS_PASSCODE || "1234";
  return passcode === correct;
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("gat_session");
}

export async function isSessionValid(): Promise<boolean> {
  return await checkSession();
}

// ── Helper ────────────────────────────────────────────────────
function rowToButton(row: any): Button {
  return {
    id: Number(row.id),
    button_name: String(row.button_name),
    source_type: row.source_type as "link" | "embed" | "code",
    source: String(row.source),
    icon: String(row.icon ?? "Cube"),
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
  }
): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  const isAuthorized = (await checkSession()) || (passcode ? await verifyPasscode(passcode) : false);
  if (!isAuthorized)
    return { success: false, error: "Unauthorized" };

  try {
    const res = await client.execute(
      `SELECT MAX("order") as max_order FROM buttons`
    );
    const maxOrder = Number(res.rows[0]?.max_order ?? -1);
    await client.execute({
      sql: `INSERT INTO buttons (button_name, source_type, source, icon, "order")
            VALUES (?, ?, ?, ?, ?)`,
      args: [data.button_name, data.source_type, data.source, data.icon, maxOrder + 1],
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
  }
): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  const isAuthorized = (await checkSession()) || (passcode ? await verifyPasscode(passcode) : false);
  if (!isAuthorized)
    return { success: false, error: "Unauthorized" };

  try {
    await client.execute({
      sql: `UPDATE buttons
            SET button_name = ?, source_type = ?, source = ?, icon = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      args: [data.button_name, data.source_type, data.source, data.icon, id],
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
  const isAuthorized = (await checkSession()) || (passcode ? await verifyPasscode(passcode) : false);
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
  const isAuthorized = (await checkSession()) || (passcode ? await verifyPasscode(passcode) : false);
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

// ── Legacy stubs (kept for non-breaking migration) ────────────
export async function getSidebarItems(): Promise<SidebarItem[]> {
  await ensureDb();
  try {
    const result = await client.execute(
      "SELECT * FROM sidebar_items WHERE is_active = 1 ORDER BY sort_order ASC"
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      url: String(row.url),
      icon: String(row.icon),
      target: row.target as "embed" | "new_tab",
      sort_order: Number(row.sort_order),
      is_active: Number(row.is_active),
    }));
  } catch {
    return [];
  }
}

export async function getAllSidebarItems(passcode: string): Promise<SidebarItem[]> {
  if (!(await verifyPasscode(passcode))) throw new Error("Unauthorized");
  return getSidebarItems();
}

export async function upsertSidebarItem(
  _passcode: string,
  _item: any
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: "Deprecated — use addButton/updateButton." };
}

export async function deleteSidebarItem(
  _passcode: string,
  _id: number
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: "Deprecated — use deleteButton." };
}

export async function reorderSidebarItems(
  _passcode: string,
  _ids: number[]
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: "Deprecated — use reorderButtons." };
}

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

export async function updateSetting(
  passcode: string,
  key: string,
  value: string
): Promise<{ success: boolean; error?: string }> {
  await ensureDb();
  const isAuthorized = (await checkSession()) || (passcode ? await verifyPasscode(passcode) : false);
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
