import crypto from "crypto";

export const SESSION_COOKIE = "gat_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
export const SUPERADMIN_ELEVATION_SECONDS = 60 * 30;

export type SessionPayload = {
  kind: "user" | "superadmin";
  userId?: number;
  name?: string;
  email?: string;
  roles: string[];
  activeRole: string;
  superadminUntil?: number;
  issuedAt: number;
  expiresAt: number;
};

export function isSuperadminElevated(session: SessionPayload, now = Date.now()): boolean {
  return session.kind === "superadmin" ||
    (typeof session.superadminUntil === "number" && session.superadminUntil > now);
}

function getSessionSecret(): string | null {
  const secret = process.env.JWT_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function createSessionToken(payload: SessionPayload): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;
  const body = encode(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  const secret = getSessionSecret();
  if (!secret || !token) return null;
  const [body, suppliedSignature, extra] = token.split(".");
  if (!body || !suppliedSignature || extra) return null;

  const expectedSignature = crypto.createHmac("sha256", secret).update(body).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return null;
  }
  if (supplied.length !== expectedSignature.length || !crypto.timingSafeEqual(supplied, expectedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!parsed || !Array.isArray(parsed.roles) || typeof parsed.activeRole !== "string") return null;
    if (parsed.kind !== "user" && parsed.kind !== "superadmin") return null;
    if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) return null;
    if (parsed.superadminUntil !== undefined && !Number.isFinite(parsed.superadminUntil)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createPasscodeHash(passcode: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(passcode, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPasscodeHash(passcode: string, storedHash: string): "valid" | "legacy" | "invalid" {
  const value = storedHash.trim();
  if (value.startsWith("scrypt$") || value.startsWith("scrypt.")) {
    const separator = value.startsWith("scrypt.") ? "." : "$";
    const [, saltText, hashText, extra] = value.split(separator);
    if (!saltText || !hashText || extra) return "invalid";
    try {
      const expected = Buffer.from(hashText, "base64url");
      const actual = crypto.scryptSync(passcode, Buffer.from(saltText, "base64url"), expected.length);
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? "valid" : "invalid";
    } catch {
      return "invalid";
    }
  }

  // One-time compatibility path for the former unsalted SHA-256 format.
  if (/^[a-f\d]{64}$/i.test(value)) {
    const expected = Buffer.from(value, "hex");
    const actual = crypto.createHash("sha256").update(passcode).digest();
    return crypto.timingSafeEqual(actual, expected) ? "legacy" : "invalid";
  }
  return "invalid";
}
