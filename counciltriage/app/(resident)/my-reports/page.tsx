import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ProgressSteps, ReportCard } from "@/components/resident";
import { PageSkeleton, buttonStyles } from "@/components/ui";
import { requireResident } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { publicEvent, publicReport } from "@/lib/public";
import { reportSummary, summaryEvent } from "@/lib/public-summary";
import { canonicalReport, getEvents, getReportsByIds, searchReports, type Report } from "@/lib/repo/reports";
import { getResidentAccount } from "@/lib/repo/residents";

export const metadata: Metadata = { title: "My reports" };

/** `own` is false for reports the resident only supported: those show council updates, not the reporter's words. */
function LatestUpdate({ report, own }: { report: Report; own: boolean }) {
  const tracked = canonicalReport(report);
  const showFull = own && tracked.id === report.id;
  const latest = getEvents(tracked.id, { publicOnly: true })
    .map(showFull ? publicEvent : summaryEvent)
    .at(-1);
  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <ProgressSteps status={tracked.status} />
      {tracked.id !== report.id && (
        <p className="text-sm text-sky-800">
          Merged with{" "}
          <Link className="font-medium underline" href={`/reports/${tracked.ref}`}>
            {tracked.ref}
          </Link>
          , which is tracking this problem.
        </p>
      )}
      {latest?.message && (
        <p className="text-sm text-slate-700">
          <span className="text-xs text-slate-500">Latest update, {formatDateTime(latest.at)}: </span>
          {latest.message}
        </p>
      )}
    </div>
  );
}

async function MyReports() {
  const resident = await requireResident("/my-reports");

  const account = getResidentAccount(resident.residentId);
  const own = searchReports({ residentId: resident.residentId, status: "all", sort: "newest", pageSize: 200 });
  const supportedIds = (
    db().prepare("SELECT report_id FROM report_supporters WHERE resident_id = ? ORDER BY created_at DESC LIMIT 100").all(resident.residentId) as { report_id: number }[]
  ).map((r) => Number(r.report_id));
  const supported = getReportsByIds(supportedIds).filter((r) => r.residentId !== resident.residentId);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-scc-navy sm:text-3xl">{account?.firstName ? `${account.firstName}'s reports` : "My reports"}</h1>
          <p className="text-slate-600">Signed in as {resident.email}</p>
        </div>
        <Link href="/report" className={buttonStyles.accent}>
          Report a problem
        </Link>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Reports you made ({own.total})</h2>
        {own.items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-slate-600">You have not made any reports yet.</p>
        ) : (
          <ul className="space-y-3" data-testid="my-reports">
            {own.items.map((r) => (
              <ReportCard key={r.id} report={publicReport(r)} extra={<LatestUpdate report={r} own />} />
            ))}
          </ul>
        )}
      </section>

      {supported.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Reports you supported ({supported.length})</h2>
          <ul className="space-y-3">
            {supported.map((r) => (
              <ReportCard key={r.id} report={reportSummary(r)} extra={<LatestUpdate report={r} own={false} />} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function MyReportsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MyReports />
    </Suspense>
  );
}
