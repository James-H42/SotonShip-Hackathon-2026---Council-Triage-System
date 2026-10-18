/** Resident accounts. Reporting never needs an account; a password lets residents sign in to see their history. */
import { db, nowIso } from "../db";
import { checkPassword, hashPassword } from "./officers";

export type ResidentAccount = { id: number; email: string; firstName: string | null; lastName: string | null; phone: string | null; hasPassword: boolean };

type Row = { id: number; email: string; first_name: string | null; last_name: string | null; phone: string | null; password_hash: string | null };

function toAccount(r: Row): ResidentAccount {
  return { id: Number(r.id), email: r.email, firstName: r.first_name, lastName: r.last_name, phone: r.phone, hasPassword: Boolean(r.password_hash) };
}

export function getResidentAccount(id: number): ResidentAccount | null {
  const row = db().prepare("SELECT * FROM residents WHERE id = ?").get(id) as Row | undefined;
  return row ? toAccount(row) : null;
}

export function createResidentAccount(a: { email: string; firstName: string; lastName: string; phone?: string | null; password: string }): number {
  const email = a.email.trim().toLowerCase();
  db()
    .prepare(
      `INSERT INTO residents (email, first_name, last_name, phone, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
         phone = COALESCE(excluded.phone, residents.phone), password_hash = excluded.password_hash`,
    )
    .run(email, a.firstName, a.lastName, a.phone ?? null, hashPassword(a.password), nowIso());
  return Number((db().prepare("SELECT id FROM residents WHERE email = ?").get(email) as { id: number }).id);
}

export function authenticateResident(email: string, password: string): ResidentAccount | null {
  const row = db().prepare("SELECT * FROM residents WHERE email = ?").get(email.trim().toLowerCase()) as Row | undefined;
  if (!row?.password_hash || !checkPassword(password, row.password_hash)) return null;
  return toAccount(row);
}
