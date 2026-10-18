import Link from "next/link";
import { CategoryIcon } from "@/components/icons";
import { StatusBadge, cx } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { ReportStatus } from "@/lib/statuses";

const PROGRESS: { label: string; statuses: ReportStatus[] }[] = [
  { label: "Received", statuses: ["received"] },
  { label: "Being processed", statuses: ["in_progress", "monitoring"] },
  { label: "Repair arranged", statuses: ["repair_scheduled"] },
  { label: "Fixed", statuses: ["completed"] },
];

/** Four-stage progress tracker shown to residents. */
export function ProgressSteps({ status }: { status: ReportStatus }) {
  if (status === "closed" || status === "duplicate") return null;
  const current = PROGRESS.findIndex((p) => p.statuses.includes(status));
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label="Progress">
      {PROGRESS.map((p, i) => {
        const done = i <= current;
        return (
          <li key={p.label} className="text-center">
            <div className={cx("h-2 rounded-full", done ? "bg-scc-navy" : "bg-slate-200")} />
            <span className={cx("mt-1 block text-xs", i === current ? "font-semibold text-scc-navy" : done ? "text-slate-700" : "text-slate-400")}>
              {i === 1 && status === "monitoring" ? "Monitoring" : p.label}
              {i === current && <span className="sr-only"> (current stage)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Fields a report card can show. Other people's reports arrive as a privacy-safe summary
 * (generic title and approximate place, no description); the resident's own reports also carry `detail`.
 */
export type CardReport = {
  ref: string;
  title: string;
  category: string;
  categoryLabel: string;
  ward: string | null;
  status: ReportStatus;
  createdAt: string;
  supporters: number;
  approxLocation?: string;
  detail?: string;
  hasPhoto?: boolean;
};

export function ReportCard({ report, extra }: { report: CardReport; extra?: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(0,25,60,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-lg text-scc-navy" aria-hidden>
            <CategoryIcon category={report.category} />
          </span>
          <div className="min-w-0">
          <Link href={`/reports/${report.ref}`} className="font-semibold text-scc-blue hover:underline">
            {report.title}
          </Link>
          <p className="mt-0.5 text-xs text-slate-500">
            {report.ref} · {report.categoryLabel} · {report.approxLocation ?? report.ward ?? "Southampton"} · reported {formatDate(report.createdAt)}
            {report.supporters > 0 && ` · ${report.supporters + 1} reports`}
            {report.hasPhoto && " · photo"}
          </p>
          </div>
        </div>
        <StatusBadge status={report.status} />
      </div>
      {report.detail && <p className="mt-2 line-clamp-2 text-sm text-slate-700">{report.detail}</p>}
      {extra}
      <Link href={`/reports/${report.ref}`} className="mt-2 inline-block text-sm font-medium text-scc-blue hover:underline" data-testid="view-report">
        View full details and updates →
      </Link>
    </li>
  );
}
