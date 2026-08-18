import type { Client } from "@libsql/client";

export interface Migration {
  id: string;
  name: string;
  target?: "app" | "auth" | "both";
  up: (ctx: { client: Client; authClient: Client }) => Promise<void>;
}


export const migrations: Migration[] = [
  {
    id: "001_init_auth_tables",
    name: "Initialize roles, users, and user_roles tables with default seeds",
    target: "auth",
    up: async ({ authClient }) => {
      await authClient.execute("PRAGMA foreign_keys = ON;");
      await authClient.execute(`
        CREATE TABLE IF NOT EXISTS roles (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT    NOT NULL UNIQUE,
          description TEXT,
          created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await authClient.execute(`
        INSERT OR IGNORE INTO roles (id, name, description) VALUES
        (1, 'admin', 'Administrator with full access'),
        (2, 'student', 'Student user access'),
        (3, 'lecturer', 'Lecturer user access'),
        (4, 'intern', 'Intern with administrative access')
      `);
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
      await authClient.execute(`
        CREATE TABLE IF NOT EXISTS user_roles (
          user_id INTEGER NOT NULL,
          role_id INTEGER NOT NULL,
          PRIMARY KEY (user_id, role_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
        )
      `);
    },
  },
  {
    id: "002_init_rate_limiting",
    name: "Initialize auth_rate_limits table and indices",
    target: "app",
    up: async ({ client }) => {
      await client.execute("PRAGMA foreign_keys = ON;");
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
    },
  },
  {
    id: "003_init_buttons_and_favorites",
    name: "Initialize buttons and user_favorites tables",
    target: "app",
    up: async ({ client }) => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS buttons (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          button_name TEXT    NOT NULL,
          source_type TEXT    NOT NULL CHECK (source_type IN ('link','embed','code')),
          source      TEXT    NOT NULL,
          icon        TEXT    NOT NULL DEFAULT 'Cube',
          image_url   TEXT,
          category    TEXT    DEFAULT 'apps',
          allowed_roles TEXT   DEFAULT 'all',
          "order"     INTEGER NOT NULL DEFAULT 0,
          created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS user_favorites (
          user_id INTEGER NOT NULL,
          button_id INTEGER NOT NULL,
          PRIMARY KEY (user_id, button_id),
          FOREIGN KEY (button_id) REFERENCES buttons(id) ON DELETE CASCADE
        )
      `);
    },
  },
  {
    id: "004_init_audit_and_usage",
    name: "Initialize audit_logs and app_usage tables with indices",
    target: "app",
    up: async ({ client }) => {
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
    },
  },
  {
    id: "005_init_announcements_and_health",
    name: "Initialize announcements and app_health tables",
    target: "app",
    up: async ({ client }) => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS announcements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
          is_active INTEGER NOT NULL DEFAULT 1,
          starts_at INTEGER,
          ends_at INTEGER,
          target_roles TEXT NOT NULL DEFAULT 'all',
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
    },
  },
  {
    id: "006_init_settings",
    name: "Initialize settings table",
    target: "app",
    up: async ({ client }) => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    },
  },
  {
    id: "007_schema_sync_and_legacy_migrations",
    name: "Ensure schema backwards compatibility and columns sync",
    target: "both",
    up: async ({ client, authClient }) => {
      // 1. Check & add columns to buttons
      const buttonInfo = await client.execute(`PRAGMA table_info(buttons)`);
      const buttonCols = new Set(buttonInfo.rows.map((r) => String(r.name).toLowerCase()));
      if (!buttonCols.has("image_url")) {
        await client.execute(`ALTER TABLE buttons ADD COLUMN image_url TEXT;`);
      }
      if (!buttonCols.has("category")) {
        await client.execute(`ALTER TABLE buttons ADD COLUMN category TEXT DEFAULT 'apps';`);
      }
      if (!buttonCols.has("allowed_roles")) {
        await client.execute(`ALTER TABLE buttons ADD COLUMN allowed_roles TEXT DEFAULT 'all';`);
      }

      // 2. Check & add column to announcements
      const annInfo = await client.execute(`PRAGMA table_info(announcements)`);
      const annCols = new Set(annInfo.rows.map((r) => String(r.name).toLowerCase()));
      if (!annCols.has("target_roles")) {
        await client.execute(`ALTER TABLE announcements ADD COLUMN target_roles TEXT NOT NULL DEFAULT 'all';`);
      }

      // 3. Check & add column to users
      const userTableInfo = await authClient.execute(`PRAGMA table_info(users)`);
      const userCols = new Set(userTableInfo.rows.map((r) => String(r.name).toLowerCase()));
      if (!userCols.has("updated_at")) {
        await authClient.execute(`ALTER TABLE users ADD COLUMN updated_at TIMESTAMP;`);
        await authClient.execute(`UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;`);
      }


      // 4. Transfer legacy favorites if present in authClient
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
    },
  },
];

async function ensureMigrationTable(dbClient: Client) {
  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function runMigrations(
  appClient: Client,
  centralAuthClient: Client = appClient
): Promise<{ applied: string[]; skipped: string[] }> {
  await ensureMigrationTable(appClient);
  if (centralAuthClient !== appClient) {
    await ensureMigrationTable(centralAuthClient);
  }

  const executedAppRes = await appClient.execute(`SELECT id FROM _migrations`);
  const appliedSet = new Set(executedAppRes.rows.map((r) => String(r.id)));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (appliedSet.has(migration.id)) {
      skipped.push(migration.id);
      continue;
    }

    try {
      await migration.up({ client: appClient, authClient: centralAuthClient });
      await appClient.execute({
        sql: `INSERT INTO _migrations (id, name) VALUES (?, ?)`,
        args: [migration.id, migration.name],
      });
      if (centralAuthClient !== appClient && migration.target !== "app") {
        await centralAuthClient.execute({
          sql: `INSERT OR IGNORE INTO _migrations (id, name) VALUES (?, ?)`,
          args: [migration.id, migration.name],
        });
      }
      applied.push(migration.id);
    } catch (err) {
      throw new Error(`Migration ${migration.id} ("${migration.name}") failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { applied, skipped };
}

export async function cleanupExpiredData(
  appClient: Client
): Promise<{ cleanedAuditLogs: number; cleanedAppUsage: number; cleanedRateLimits: number }> {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  
  await appClient.execute({
    sql: "DELETE FROM auth_rate_limits WHERE updated_at < ?",
    args: [thirtyDaysAgo],
  });

  await appClient.batch([
    "DELETE FROM audit_logs WHERE created_at < datetime('now', '-30 days')",
    "DELETE FROM app_usage WHERE opened_at < datetime('now', '-30 days')",
  ], "write");

  return { cleanedAuditLogs: 1, cleanedAppUsage: 1, cleanedRateLimits: 1 };
}

