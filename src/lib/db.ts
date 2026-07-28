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
  image_url?: string | null;
  category?: string | null;
  allowed_roles?: string | null;
  order: number;
  created_at: string;
  updated_at: string;
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
  role_ids: number[];
  role_names: string[];
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. User Roles Junction Table (Central Auth DB)
    await authClient.execute(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id INTEGER NOT NULL,
        role_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, role_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
      )
    `);

    // 4. User Favorites Table (Central Auth DB)
    await authClient.execute(`
      CREATE TABLE IF NOT EXISTS user_favorites (
        user_id INTEGER NOT NULL,
        button_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, button_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (button_id) REFERENCES buttons(id) ON DELETE CASCADE
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
        image_url   TEXT,
        category    TEXT    DEFAULT 'apps',
        "order"     INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Column migration for existing databases
    try {
      const tableInfo = await client.execute(`PRAGMA table_info(buttons)`);
      const hasImageUrl = tableInfo.rows.some(
        (row: any) => String(row.name).toLowerCase() === "image_url"
      );
      if (!hasImageUrl) {
        await client.execute(`ALTER TABLE buttons ADD COLUMN image_url TEXT;`);
      }
      const hasCategory = tableInfo.rows.some(
        (row: any) => String(row.name).toLowerCase() === "category"
      );
      if (!hasCategory) {
        await client.execute(`ALTER TABLE buttons ADD COLUMN category TEXT DEFAULT 'apps';`);
      }
      const hasAllowedRoles = tableInfo.rows.some(
        (row: any) => String(row.name).toLowerCase() === "allowed_roles"
      );
      if (!hasAllowedRoles) {
        await client.execute(`ALTER TABLE buttons ADD COLUMN allowed_roles TEXT DEFAULT 'all';`);
      }
    } catch (e) {
      console.error("Migration error for buttons columns:", e);
    }

    try {
      const userTableInfo = await authClient.execute(`PRAGMA table_info(users)`);
      const hasUpdatedAt = userTableInfo.rows.some(
        (row: any) => String(row.name).toLowerCase() === "updated_at"
      );
      if (!hasUpdatedAt) {
        await authClient.execute(`ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
      }
    } catch (e) {
      console.error("Migration error for users columns:", e);
    }

    // Settings table for home page content and config
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
