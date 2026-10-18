import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui";
import { getResident } from "@/lib/auth";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Resident sign in" };

function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/council") ? next : "/my-reports";
}

async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next);
  if (await getResident()) redirect(next);
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="font-display text-2xl font-bold text-scc-navy">Sign in to see your reports</h1>
      <p className="mt-2 mb-6 text-slate-600">Follow every report you have made or supported, from received to fixed.</p>
      <SignInForm next={next} />
      <p className="mt-6 border-t border-slate-100 pt-4 text-sm text-slate-600">
        You do not need an account to{" "}
        <Link href="/report" className="font-semibold text-scc-blue underline">
          report a problem
        </Link>
        . Council staff should use the{" "}
        <Link href="/council/login" className="font-semibold text-scc-blue underline">
          staff sign-in
        </Link>
        .
      </p>
    </div>
  );
}

export default function ResidentLoginPage({ searchParams }: PageProps<"/resident/login">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SignIn searchParams={searchParams} />
    </Suspense>
  );
}
