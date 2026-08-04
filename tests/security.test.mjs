import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

process.env.JWT_SECRET = "test-only-secret-that-is-at-least-32-characters-long";

const {
  createPasscodeHash,
  createSessionToken,
  isSuperadminElevated,
  verifyPasscodeHash,
  verifySessionToken,
} = await import("../src/lib/security.ts");

function session(overrides = {}) {
  const now = Date.now();
  return {
    kind: "user",
    userId: 7,
    name: "Test User",
    email: "test@example.com",
    roles: ["administrator"],
    activeRole: "administrator",
    issuedAt: now,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

test("accepts a valid signed session and rejects tampering", () => {
  const token = createSessionToken(session());
  assert.ok(token);
  assert.equal(verifySessionToken(token)?.userId, 7);
  assert.equal(verifySessionToken(`${token.slice(0, -1)}x`), null);
});

test("rejects expired sessions", () => {
  const token = createSessionToken(session({ expiresAt: Date.now() - 1 }));
  assert.ok(token);
  assert.equal(verifySessionToken(token), null);
});

test("Superadmin elevation preserves user identity and expires independently", () => {
  const now = Date.now();
  const elevated = session({ superadminUntil: now + 30_000 });
  const token = createSessionToken(elevated);
  const restored = verifySessionToken(token);
  assert.equal(restored?.kind, "user");
  assert.equal(restored?.email, "test@example.com");
  assert.equal(isSuperadminElevated(restored, now), true);
  assert.equal(isSuperadminElevated(restored, now + 30_001), false);
});

test("scrypt hashes verify without storing the passcode", () => {
  const hash = createPasscodeHash("correct horse battery staple");
  assert.match(hash, /^scrypt\$/);
  assert.equal(hash.includes("correct horse battery staple"), false);
  assert.equal(verifyPasscodeHash("correct horse battery staple", hash), "valid");
  assert.equal(verifyPasscodeHash("wrong passcode", hash), "invalid");
});

test("Next.js-safe dot-separated scrypt hashes verify", () => {
  const databaseHash = createPasscodeHash("test-passcode-123");
  const environmentHash = databaseHash.replaceAll("$", ".");
  assert.equal(verifyPasscodeHash("test-passcode-123", environmentHash), "valid");
  assert.equal(verifyPasscodeHash("12345", environmentHash), "invalid");
});

test("recognizes a valid legacy SHA-256 hash for automatic migration", () => {
  const hash = crypto.createHash("sha256").update("legacy passcode").digest("hex");
  assert.equal(verifyPasscodeHash("legacy passcode", hash), "legacy");
});
