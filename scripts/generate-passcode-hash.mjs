import crypto from "node:crypto";

const passcode = process.argv[2];
if (!passcode || passcode.length < 12) {
  console.error('Usage: npm run generate-passcode-hash -- "a passcode of at least 12 characters"');
  process.exitCode = 1;
} else {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(passcode, salt, 64);
  // Period separators are safe in Next.js .env files; unescaped dollar signs are expanded.
  console.log(`scrypt.${salt.toString("base64url")}.${hash.toString("base64url")}`);
}
