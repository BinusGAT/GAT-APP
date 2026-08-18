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

import { runMigrations } from "./migrate";

export async function initDb() {
  return runMigrations(client, authClient);
}


