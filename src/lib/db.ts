import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const isTurso = !!(url && authToken);

export const client = isTurso
  ? createClient({ url, authToken })
  : createClient({ url: "file:local.db" });

// ── New: GAT Hub button ──────────────────────────────────────
export interface Button {
  id: number;
  button_name: string;
  source_type: "link" | "embed" | "code";
  source: string;
  icon: string;
  order: number;
  created_at: string;
  updated_at: string;
}

// ── Legacy: kept for type compatibility ──────────────────────
export interface SidebarItem {
  id: number;
  name: string;
  url: string;
  icon: string;
  target: "embed" | "new_tab";
  sort_order: number;
  is_active: number;
}

export async function initDb() {
  try {
    // New buttons table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS buttons (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        button_name TEXT    NOT NULL,
        source_type TEXT    NOT NULL CHECK (source_type IN ('link','embed','code')),
        source      TEXT    NOT NULL,
        icon        TEXT    NOT NULL DEFAULT 'Cube',
        "order"     INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Legacy tables — kept for non-destructive migration
    await client.execute(`
      CREATE TABLE IF NOT EXISTS sidebar_items (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        url        TEXT    NOT NULL,
        icon       TEXT    NOT NULL,
        target     TEXT    NOT NULL,
        sort_order INTEGER NOT NULL,
        is_active  INTEGER NOT NULL DEFAULT 1
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  } catch (error) {
    console.error("Failed to initialize database:", error);
  }
}
