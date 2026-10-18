import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageSkeleton, StatusBadge, buttonStyles } from "@/components/ui";
import { getEvents, getReportByRef } from "@/lib/repo/reports";

export const metadata: Metadata = { title: "Report sent" };

async function Confirmation({ params }: { params: Promise<{ ref: string }> }) {
  await connection();
  const { ref } = await params;
  const report = getReportByRef(ref);
  if (!report || report.source !== "resident") notFound();
  const latest = getEvents(report.id, { publicOnly: true }).at(-1);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-2xl bg-emerald-700 p-8 text-center text-white">
        <h1 className="text-2xl font-semibold sm:text-3xl">Report sent</h1>
        <p className="mt-2 text-emerald-100">Your reference number is</p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-wider" data-testid="report-ref">
          {report.ref}
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">What happens next</h2>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm text-slate-600">Current status:</span>
          <StatusBadge status={report.status} />
        </div>
        {latest?.message && <p className="mt-3 text-slate-700">{latest.message}</p>}
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Your report has been checked automatically and added to the council&apos;s prioritised list.</li>
          {report.status !== "monitoring" && report.responseTarget && (
            <li>
              Target response for problems like this: <strong>{report.responseTarget.toLowerCase()}</strong>.
            </li>
          )}
          <li>We will post updates on the report page as it moves from received to fixed.</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/reports/${report.ref}`} className={buttonStyles.primary}>
            Track this report
          </Link>
          <Link href="/my-reports" className={buttonStyles.secondary}>
            All my reports
          </Link>
          <Link href="/report" className={buttonStyles.secondary}>
            Report another problem
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SubmittedPage({ params }: PageProps<"/report/submitted/[ref]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Confirmation params={params} />
    </Suspense>
  );
}
