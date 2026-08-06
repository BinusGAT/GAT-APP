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

    // App-specific authentication throttling state. Keys are HMAC hashes so
    // account identifiers and client IP addresses are never stored in plaintext.
    await client.execute(`
      CREATE TABLE IF NOT EXISTS auth_rate_limits (
        key               TEXT PRIMARY KEY,
        attempt_count     INTEGER NOT NULL DEFAULT 0,
        window_expires_at INTEGER NOT NULL,
        locked_until      INTEGER NOT NULL DEFAULT 0,
        updated_at        INTEGER NOT NULL
      )
    `);
    await client.execute(`
      CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated_at
      ON auth_rate_limits(updated_at)
    `);
    await client.execute({
      sql: "DELETE FROM auth_rate_limits WHERE updated_at < ?",
      args: [Date.now() - 30 * 24 * 60 * 60 * 1000],
    });

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

    // 4. User Favorites Table (GAT App Data DB)
    await client.execute(`
      CREATE TABLE IF NOT EXISTS user_favorites (
        user_id INTEGER NOT NULL,
        button_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, button_id),
        FOREIGN KEY (button_id) REFERENCES buttons(id) ON DELETE CASCADE
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER,
        actor_email TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)`);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS app_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        button_id INTEGER NOT NULL,
        opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (button_id) REFERENCES buttons(id) ON DELETE CASCADE
      )
    `);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_app_usage_user_time ON app_usage(user_id, opened_at DESC)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_app_usage_button_time ON app_usage(button_id, opened_at DESC)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_app_usage_opened_at ON app_usage(opened_at)`);

    // Retain detailed operational records for 30 days. These indexed deletes
    // are safe to repeat on cold starts and keep the app database bounded.
    await client.batch([
      "DELETE FROM audit_logs WHERE created_at < datetime('now', '-30 days')",
      "DELETE FROM app_usage WHERE opened_at < datetime('now', '-30 days')",
    ], "write");

    await client.execute(`
      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
        is_active INTEGER NOT NULL DEFAULT 1,
        starts_at INTEGER,
        ends_at INTEGER,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS app_health (
        button_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('healthy','degraded','down','unknown','unsupported')),
        status_code INTEGER,
        latency_ms INTEGER,
        message TEXT,
        checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (button_id) REFERENCES buttons(id) ON DELETE CASCADE
      )
    `);

    // Migration: Transfer legacy user_favorites from Central Auth DB to GAT App DB if existing
    try {
      if (authClient !== client) {
        const legacyFavCheck = await authClient.execute(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='user_favorites'`
        );
        if (legacyFavCheck.rows.length > 0) {
          const oldFavs = await authClient.execute(`SELECT user_id, button_id FROM user_favorites`);
          for (const row of oldFavs.rows) {
            await client.execute({
              sql: `INSERT OR IGNORE INTO user_favorites (user_id, button_id) VALUES (?, ?)`,
              args: [row.user_id, row.button_id],
            });
          }
          await authClient.execute(`DROP TABLE IF EXISTS user_favorites`);
        }
      }
    } catch (migErr) {
      console.error("Migration error for user_favorites from auth DB:", migErr);
    }

    // Column migration for existing databases
    try {
      const tableInfo = await client.execute(`PRAGMA table_info(buttons)`);
      const hasImageUrl = tableInfo.rows.some(
        (row) => String(row.name).toLowerCase() === "image_url"
      );
      if (!hasImageUrl) {
        await client.execute(`ALTER TABLE buttons ADD COLUMN image_url TEXT;`);
      }
      const hasCategory = tableInfo.rows.some(
        (row) => String(row.name).toLowerCase() === "category"
      );
      if (!hasCategory) {
        await client.execute(`ALTER TABLE buttons ADD COLUMN category TEXT DEFAULT 'apps';`);
      }
      const hasAllowedRoles = tableInfo.rows.some(
        (row) => String(row.name).toLowerCase() === "allowed_roles"
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
        (row) => String(row.name).toLowerCase() === "updated_at"
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
