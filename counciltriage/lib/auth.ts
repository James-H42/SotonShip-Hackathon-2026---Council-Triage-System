/**
 * Signed-cookie sessions for the two separate areas of the system.
 *
 * Residents and officers have different cookies, so being signed in to one
 * area never grants access to the other.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { config } from "./config";
export { authenticateOfficer } from "./repo/officers";

export const OFFICER_COOKIE = "st_officer";
export const RESIDENT_COOKIE = "st_resident";
const OFFICER_TTL_S = 60 * 60 * 10; // one working day
const RESIDENT_TTL_S = 60 * 60 * 24 * 90;

export type OfficerSession = { kind: "officer"; officerId: number; name: string; email: string; role: string; exp: number };
export type ResidentSession = { kind: "resident"; residentId: number; email: string; exp: number };

let cachedSecret: string | null = null;
function secret(): string {
  if (cachedSecret) return cachedSecret;
  if (config.sessionSecret) return (cachedSecret = config.sessionSecret);
  // Local development: generate once and keep it beside the database.
  const file = path.join(config.dataDir, ".session-secret");
  try {
    cachedSecret = fs.readFileSync(file, "utf8").trim();
  } catch {
    fs.mkdirSync(config.dataDir, { recursive: true });
    cachedSecret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
  }
  return cachedSecret;
}

export function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T extends { exp: number }>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    return payload.exp * 1000 > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers (Server Components, Server Actions and Route Handlers)
// ---------------------------------------------------------------------------

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge,
});

export async function startOfficerSession(officer: { id: number; name: string; email: string; role: string }) {
  const exp = Math.floor(Date.now() / 1000) + OFFICER_TTL_S;
  (await cookies()).set(
    OFFICER_COOKIE,
    sign({ kind: "officer", officerId: officer.id, name: officer.name, email: officer.email, role: officer.role, exp }),
    cookieOptions(OFFICER_TTL_S),
  );
}

export async function startResidentSession(residentId: number, email: string) {
  const exp = Math.floor(Date.now() / 1000) + RESIDENT_TTL_S;
  (await cookies()).set(RESIDENT_COOKIE, sign({ kind: "resident", residentId, email, exp }), cookieOptions(RESIDENT_TTL_S));
}

export async function endSession(kind: "officer" | "resident") {
  // Overwrite with the same attributes and an immediate expiry, so the browser drops the exact cookie it holds.
  (await cookies()).set(kind === "officer" ? OFFICER_COOKIE : RESIDENT_COOKIE, "", { ...cookieOptions(0), expires: new Date(0) });
}

/** Signing out on a shared device ends both the resident and the officer session. */
export async function endAllSessions() {
  await endSession("officer");
  await endSession("resident");
}

// Checking expiry compares against the clock, so it must happen at request time (connection()),
// not during prerendering or prefetching.
export async function getOfficer(): Promise<OfficerSession | null> {
  const token = (await cookies()).get(OFFICER_COOKIE)?.value;
  if (!token) return null;
  await connection();
  const s = verify<OfficerSession>(token);
  return s?.kind === "officer" ? s : null;
}

export async function getResident(): Promise<ResidentSession | null> {
  const token = (await cookies()).get(RESIDENT_COOKIE)?.value;
  if (!token) return null;
  await connection();
  const s = verify<ResidentSession>(token);
  return s?.kind === "resident" ? s : null;
}

/** For pages and Server Actions in the council area. */
export async function requireOfficer(): Promise<OfficerSession> {
  const officer = await getOfficer();
  if (!officer) redirect("/council/login");
  return officer;
}

/** For resident-only pages: sends signed-out visitors to the resident sign-in page, then back. */
export async function requireResident(next: string): Promise<ResidentSession> {
  const resident = await getResident();
  if (!resident) redirect(`/resident/login?next=${encodeURIComponent(next)}`);
  return resident;
}

/** For council Route Handlers: returns a 401 response instead of redirecting. */
export async function officerOrUnauthorized(): Promise<OfficerSession | Response> {
  const officer = await getOfficer();
  return officer ?? Response.json({ error: "Council officer sign-in required" }, { status: 401 });
}
