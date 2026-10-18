/** Council officer accounts. */
import crypto from "node:crypto";
import { db, nowIso } from "../db";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function createOfficer(email: string, name: string, password: string, role = "officer") {
  db()
    .prepare(
      `INSERT INTO officers (email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, password_hash = excluded.password_hash`,
    )
    .run(email.trim().toLowerCase(), name, role, hashPassword(password), nowIso());
}

export function authenticateOfficer(email: string, password: string) {
  const row = db().prepare("SELECT * FROM officers WHERE email = ?").get(email.trim().toLowerCase()) as
    | { id: number; email: string; name: string; role: string; password_hash: string }
    | undefined;
  if (!row || !checkPassword(password, row.password_hash)) return null;
  return { id: Number(row.id), email: row.email, name: row.name, role: row.role };
}


