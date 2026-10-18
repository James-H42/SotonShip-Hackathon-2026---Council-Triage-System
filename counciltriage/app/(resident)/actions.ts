"use server";

import { redirect } from "next/navigation";
import { endAllSessions, startResidentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getReportByRef } from "@/lib/repo/reports";
import { authenticateResident } from "@/lib/repo/residents";

export type SignInState = { error?: string; email?: string; mode?: "password" | "reference" };

/** Account holders sign in with email and password. */
export async function residentSignIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email address and password.", email, mode: "password" };
  const account = authenticateResident(email, password);
  if (!account) return { error: "Email address or password not recognised.", email, mode: "password" };
  await startResidentSession(account.id, account.email);
  redirect(safeNext(String(formData.get("next") ?? "")));
}

/** Anyone who reported without an account can follow their reports with their email and a report reference. */
export async function residentTrack(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const ref = String(formData.get("ref") ?? "").trim().toUpperCase();
  if (!email || !ref) return { error: "Enter your email address and a report reference.", email, mode: "reference" };
  const report = getReportByRef(ref);
  const resident = report?.residentId
    ? (db().prepare("SELECT id, email FROM residents WHERE id = ?").get(report.residentId) as { id: number; email: string } | undefined)
    : undefined;
  if (!resident || resident.email !== email) {
    return { error: "We could not find a report with that reference for that email address.", email, mode: "reference" };
  }
  await startResidentSession(Number(resident.id), email);
  redirect(safeNext(String(formData.get("next") ?? "")));
}

function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/council") ? next : "/my-reports";
}

/** Clears the session cookies server-side and returns to the "Resident or council staff?" chooser. */
export async function residentSignOut() {
  await endAllSessions();
  redirect("/");
}
