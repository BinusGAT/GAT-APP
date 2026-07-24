import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const isTurso = !!(url && authToken);

export const client = isTurso
  ? createClient({ url, authToken })
  : createClient({ url: "file:local.db" });

const authUrl = process.env.AUTH_DATABASE_URL || url;
const authDatabaseToken = process.env.AUTH_DATABASE_TOKEN || authToken;
const isAuthTurso = !!(authUrl && authDatabaseToken);

export const authClient = isAuthTurso
  ? createClient({ url: authUrl, authToken: authDatabaseToken })
  : client;

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

// ── User & Role Management (2-Table Setup) ───────────────────
export interface Role {
  id: number;
  name: string;
  description?: string;
  created_at: string;
}

export interface User {
  id: number;
  email: string;
  nim: string | null;
  name: string;
  role_id: number;
  created_at: string;
  updated_at: string;
}

export interface UserWithRole extends User {
  role_name: string;
}

export async function initDb() {
  try {
    // Enable foreign keys
    await authClient.execute(`PRAGMA foreign_keys = ON;`);
    await client.execute(`PRAGMA foreign_keys = ON;`);

    // 1. Roles Table (Central Auth DB)
    await authClient.execute(`
      CREATE TABLE IF NOT EXISTS roles (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL UNIQUE,
        description TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed default roles
    await authClient.execute(`
      INSERT OR IGNORE INTO roles (id, name, description) VALUES
      (1, 'admin', 'Administrator with full access'),
      (2, 'student', 'Student user access'),
      (3, 'lecturer', 'Lecturer user access'),
      (4, 'intern', 'Intern with administrative access')
    `);

    // 2. Users Table (Central Auth DB)
    await authClient.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        email      TEXT    NOT NULL UNIQUE,
        nim        TEXT    UNIQUE,
        name       TEXT    NOT NULL,
        role_id    INTEGER NOT NULL DEFAULT 2,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
      )
    `);

    // 3. Buttons Table (GAT App Data DB)
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
