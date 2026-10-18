"use server";

import { redirect } from "next/navigation";
import { authenticateOfficer, endAllSessions, startOfficerSession } from "@/lib/auth";

export type LoginState = { error?: string; email?: string };

function safeNext(next: string): string {
  return next.startsWith("/council") && !next.startsWith("//") ? next : "/council";
}

export async function officerLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your council email address and password.", email };
  const officer = authenticateOfficer(email, password);
  if (!officer) return { error: "Email or password not recognised.", email };
  await startOfficerSession(officer);
  redirect(safeNext(String(formData.get("next") ?? "/council")));
}

/** Clears the session cookies server-side and returns to the "Resident or council staff?" chooser. */
export async function officerLogout() {
  await endAllSessions();
  redirect("/");
}
