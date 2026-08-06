import crypto from "node:crypto";
import { headers } from "next/headers";
import { client } from "./db";

type RateLimitPolicy = {
  maxAttempts: number;
  windowMs: number;
  lockMs: number;
};

export const LOGIN_ACCOUNT_POLICY: RateLimitPolicy = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  lockMs: 30 * 60 * 1000,
};

export const LOGIN_IP_POLICY: RateLimitPolicy = {
  maxAttempts: 20,
  windowMs: 15 * 60 * 1000,
  lockMs: 30 * 60 * 1000,
};

export const SUPERADMIN_ACCOUNT_POLICY: RateLimitPolicy = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  lockMs: 60 * 60 * 1000,
};

export const SUPERADMIN_IP_POLICY: RateLimitPolicy = {
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  lockMs: 60 * 60 * 1000,
};

function rateLimitSecret(): string | null {
  const secret = process.env.JWT_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function keyedHash(value: string): string | null {
  const secret = rateLimitSecret();
  return secret
    ? crypto.createHmac("sha256", secret).update(value).digest("base64url")
    : null;
}

export async function getClientIpHash(): Promise<string | null> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = requestHeaders.get("cf-connecting-ip")?.trim()
    || forwarded
    || requestHeaders.get("x-real-ip")?.trim()
    || "unknown";
  return keyedHash(`ip:${ip}`);
}

export function createRateLimitKey(scope: string, identifier: string): string | null {
  return keyedHash(`${scope}:${identifier.trim().toLowerCase()}`);
}

export async function getLockRemainingMs(keys: string[], now = Date.now()): Promise<number> {
  if (keys.length === 0) return 0;
  const placeholders = keys.map(() => "?").join(",");
  const result = await client.execute({
    sql: `SELECT MAX(locked_until) AS locked_until FROM auth_rate_limits WHERE key IN (${placeholders})`,
    args: keys,
  });
  const lockedUntil = Number(result.rows[0]?.locked_until || 0);
  return Math.max(0, lockedUntil - now);
}

export async function recordFailure(
  key: string,
  policy: RateLimitPolicy,
  now = Date.now()
): Promise<void> {
  const windowExpiresAt = now + policy.windowMs;
  const lockedUntil = now + policy.lockMs;
  await client.execute({
    sql: `
      INSERT INTO auth_rate_limits (key, attempt_count, window_expires_at, locked_until, updated_at)
      VALUES (?, 1, ?, 0, ?)
      ON CONFLICT(key) DO UPDATE SET
        attempt_count = CASE
          WHEN auth_rate_limits.window_expires_at <= ? THEN 1
          ELSE auth_rate_limits.attempt_count + 1
        END,
        window_expires_at = CASE
          WHEN auth_rate_limits.window_expires_at <= ? THEN excluded.window_expires_at
          ELSE auth_rate_limits.window_expires_at
        END,
        locked_until = CASE
          WHEN (CASE
            WHEN auth_rate_limits.window_expires_at <= ? THEN 1
            ELSE auth_rate_limits.attempt_count + 1
          END) >= ? THEN ?
          ELSE auth_rate_limits.locked_until
        END,
        updated_at = excluded.updated_at
    `,
    args: [key, windowExpiresAt, now, now, now, now, policy.maxAttempts, lockedUntil],
  });
}

export async function resetRateLimit(key: string): Promise<void> {
  await client.execute({
    sql: "DELETE FROM auth_rate_limits WHERE key = ?",
    args: [key],
  });
}

export function formatLockMessage(remainingMs: number): string {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return `Too many authentication attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
