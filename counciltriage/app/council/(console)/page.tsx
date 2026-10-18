import {
  faCircleExclamation,
  faClock,
  faCodeMerge,
  faFire,
  faInbox,
  faListCheck,
  faRoute,
  faSliders,
} from "@fortawesome/free-solid-svg-icons";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { CategoryIcon, Icon } from "@/components/icons";
import { MapPanel } from "@/components/map/MapPanel";
import { FlagChips, PageSkeleton, compactInputStyles, PriorityBadge, Stat, StatusBadge, buttonStyles, cx, inputStyles } from "@/components/ui";
import { requireOfficer } from "@/lib/auth";
import { getDashboardStats } from "@/lib/data";
import { ageLabel, formatDate, requestTime } from "@/lib/format";
import { WARD_NAMES } from "@/lib/geo";
import { getLinkedReports, searchReports } from "@/lib/repo/reports";
import { parseSearchParams, toQuery } from "@/lib/search-params";
import { STATUSES } from "@/lib/statuses";
import { CATEGORIES, categoryLabel } from "@/lib/taxonomy";
import { BAND_ORDER } from "@/lib/triage/priority";
import { bulkStatusAction } from "./actions";

export const metadata: Metadata = { title: "Priority queue" };

type SP = Record<string, string | string[] | undefined>;

const QUEUES = [
  { id: "", label: "All open" },
  { id: "review", label: "Needs review" },
  { id: "duplicates", label: "Possible duplicates" },
  { id: "dubious", label: "Dubious" },
  { id: "unscheduled", label: "Not yet scheduled" },
];

const STATUS_TABS = [
  { status: "in_progress", label: "In progress" },
  { status: "repair_scheduled", label: "Repair arranged" },
  { status: "completed", label: "Completed" },
] as const;

const PAGE_SIZE = 50;
const MAP_PIN_LIMIT = 15000;

async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  await requireOfficer();
  const sp = await searchParams;
  const filters = parseSearchParams(sp);
  const result = searchReports({ ...filters, pageSize: PAGE_SIZE });
  const stats = getDashboardStats();
  const current = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const listQuery = toQuery({ ...current, page: undefined });
  const now = requestTime();
  const advancedOpen = Boolean(filters.source || filters.hasPhoto || filters.status !== "open" || filters.sort !== "priority");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-scc-navy">{filters.queue ? QUEUES.find((q) => q.id === filters.queue)?.label : "Priority queue"}</h1>
          <p className="text-sm text-slate-600">Ranked by calculated urgency. Open a report to review it, then use &ldquo;Next in queue&rdquo; to keep going.</p>
        </div>
        <Link href="/council/routes" className={buttonStyles.primary}>
          <Icon icon={faRoute} /> Plan crew routes
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Open" value={stats.open.toLocaleString()} href="/council" hint={`${stats.last7Days} new this week`} icon={faInbox} />
        <Stat label="Critical" value={(stats.byBand.critical ?? 0).toLocaleString()} tone="critical" href="/council?band=critical" hint="Respond within 24h" icon={faFire} />
        <Stat label="High" value={(stats.byBand.high ?? 0).toLocaleString()} tone="high" href="/council?band=high" hint="Within 5 working days" icon={faCircleExclamation} />
        <Stat label="Needs review" value={stats.needsReview.toLocaleString()} tone="medium" href="/council?queue=review" hint="TBC or flagged" icon={faListCheck} />
        <Stat label="Duplicates" value={stats.duplicates.toLocaleString()} tone="low" href="/council?queue=duplicates" hint="Suggested matches" icon={faCodeMerge} />
        <Stat label="Past target" value={stats.overdue.toLocaleString()} tone="critical" href="/council?sort=due" hint={`${stats.overdueResident} new, rest imported backlog`} icon={faClock} />
      </div>

      <form className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(0,25,60,0.06)]" role="search" data-testid="filters">
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Queues">
          {QUEUES.map((q) => (
            <Link
              key={q.id}
              href={`/council${toQuery({ ...current, queue: q.id, status: undefined, page: undefined })}`}
              className={cx(
                "rounded-full px-3 py-1 text-xs font-semibold",
                (filters.queue ?? "") === q.id && filters.status === "open" ? "bg-scc-navy text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
            >
              {q.label}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
          {STATUS_TABS.map((t) => (
            <Link
              key={t.status}
              href={`/council${toQuery({ ...current, queue: undefined, status: t.status, page: undefined })}`}
              className={cx("rounded-full px-3 py-1 text-xs font-semibold", filters.status === t.status ? "bg-scc-navy text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}
              data-testid={`tab-${t.status}`}
            >
              {t.label} <span className="font-normal opacity-75">{(stats.byStatus?.[t.status] ?? 0).toLocaleString()}</span>
            </Link>
          ))}
        </div>
        {filters.queue && <input type="hidden" name="queue" value={filters.queue} />}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <input name="q" defaultValue={filters.q} className={inputStyles} placeholder="Search text or reference" aria-label="Search text or reference" />
          <select name="category" defaultValue={filters.category ?? ""} className={inputStyles} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            <option value="tbc">TBC (needs review)</option>
          </select>
          <select name="ward" defaultValue={filters.ward ?? ""} className={inputStyles} aria-label="Ward">
            <option value="">All wards</option>
            {WARD_NAMES.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
          <select name="band" defaultValue={filters.band ?? ""} className={inputStyles} aria-label="Priority">
            <option value="">All priorities</option>
            {BAND_ORDER.map((b) => (
              <option key={b} value={b}>
                {b[0].toUpperCase() + b.slice(1)}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button className={buttonStyles.primary}>Apply</button>
            <Link href="/council" className={buttonStyles.secondary}>
              Reset
            </Link>
          </div>
        </div>
        <details className="mt-2" open={advancedOpen}>
          <summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-scc-blue">
            <Icon icon={faSliders} /> More filters
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select name="status" defaultValue={filters.status} className={inputStyles} aria-label="Status">
              <option value="open">All open</option>
              <option value="closed">Closed</option>
              <option value="all">Everything</option>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.officerLabel}
                </option>
              ))}
            </select>
            <select name="sort" defaultValue={filters.sort} className={inputStyles} aria-label="Sort">
              <option value="priority">Highest priority first</option>
              <option value="due">Target date</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
            <select name="source" defaultValue={filters.source ?? ""} className={inputStyles} aria-label="Source">
              <option value="">All sources</option>
              <option value="resident">Reported on this service</option>
              <option value="fixmystreet">Imported from FixMyStreet</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="photo" value="1" defaultChecked={filters.hasPhoto} className="h-4 w-4 accent-scc-navy" /> Only with a photo
            </label>
          </div>
        </details>
      </form>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <ActionForm action={bulkStatusAction} className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(0,25,60,0.06)]" testId="bulk-form">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <p className="text-sm text-slate-700" data-testid="queue-count">
              <strong className="text-scc-navy">{result.total.toLocaleString()}</strong> report{result.total === 1 ? "" : "s"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">With selected:</span>
              <select name="status" className={compactInputStyles} defaultValue="in_progress" aria-label="New status for selected reports">
                {STATUSES.filter((s) => s.id !== "duplicate").map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.officerLabel}
                  </option>
                ))}
              </select>
              <input name="message" placeholder="Message to residents (optional)" className={cx(compactInputStyles, "w-52")} aria-label="Message to residents" />
              <SubmitButton className={buttonStyles.smallPrimary}>Update</SubmitButton>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-2 py-2">#</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Report</th>
                  <th className="px-3 py-2">Ward</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.items.map((r, i) => {
                  // A merged incident shows as one row; its individual reports expand underneath.
                  const merged = r.supporters > 0 ? getLinkedReports(r.id).merged : [];
                  const confirmations = Math.max(0, r.supporters - merged.reduce((n, m) => n + 1 + m.report.supporters, 0));
                  const overdue = r.dueAt && new Date(r.dueAt).getTime() < now && ["received", "in_progress"].includes(r.status);
                  return (
                    <tr key={r.id} className="align-top hover:bg-brand-50/60">
                      <td className="px-3 py-3">
                        <input type="checkbox" name="ids" value={r.id} aria-label={`Select ${r.ref}`} className="h-4 w-4 accent-scc-navy" />
                      </td>
                      <td className="px-2 py-3 tabular-nums text-slate-400">{(result.page - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-3 py-3">
                        <PriorityBadge band={r.priorityBand} score={r.priorityScore} />
                      </td>
                      <td className="max-w-md px-3 py-3">
                        <div className="flex gap-2.5">
                          <span className="mt-0.5 text-base text-scc-navy/70" title={categoryLabel(r.category)}>
                            <CategoryIcon category={r.category} />
                          </span>
                          <div className="min-w-0">
                            <Link href={`/council/reports/${r.id}${listQuery}`} className="font-semibold text-scc-navy hover:text-scc-blue hover:underline">
                              {r.title}
                            </Link>
                            <div className="text-xs text-slate-500">
                              {r.ref} · {r.category === "other" && r.triage?.text?.llmLabel && r.triage.text.llmLabel !== "Other" ? r.triage.text.llmLabel : categoryLabel(r.category)} · {ageLabel(r.createdAt, now)} old
                              {r.hasPhoto && " · photo"}
                              {r.supporters > 0 && ` · +${r.supporters} reports`}
                              {(r.triage?.priority.risk?.injuriesPerWeek ?? 0) > 0 && <span className="font-semibold text-critical"> · injury reported</span>}
                              {r.triage?.text?.vulnerable && <span className="font-semibold text-scc-navy"> · vulnerable people</span>}
                              {r.suggestedCategory && r.suggestedCategory !== r.category && ` · AI suggests ${categoryLabel(r.suggestedCategory)}`}
                            </div>
                            {r.flags.length > 0 && (
                              <div className="mt-1">
                                <FlagChips flags={r.flags} limit={2} />
                              </div>
                            )}
                            {(merged.length > 0 || confirmations > 0) && (
                              <details className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50/80 text-xs" data-testid="merged-expand">
                                <summary className="cursor-pointer px-2 py-1 font-medium text-scc-navy">
                                  Merged incident: {1 + r.supporters} reports
                                  {confirmations > 0 && ` (${confirmations} resident${confirmations === 1 ? "" : "s"} confirmed the same problem)`}
                                </summary>
                                <ul className="divide-y divide-slate-200 border-t border-slate-200">
                                  <li className="px-2 py-1 text-slate-600">
                                    <span className="font-medium text-slate-800">{r.ref}</span> (main) · {formatDate(r.createdAt)}
                                  </li>
                                  {merged.map((m) => (
                                    <li key={m.report.id} className="px-2 py-1">
                                      <Link href={`/council/reports/${m.report.id}`} className="font-medium text-scc-blue hover:underline">
                                        {m.report.ref}
                                      </Link>{" "}
                                      · {m.report.title} · {formatDate(m.report.createdAt)}
                                      {m.report.source === "fixmystreet" ? " · FixMyStreet" : ""}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{r.ward ?? "-"}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={r.status} audience="officer" />
                      </td>
                      <td className={cx("whitespace-nowrap px-3 py-3 text-xs", overdue ? "font-semibold text-critical" : "text-slate-600")}>
                        {r.responseTarget ?? "-"}
                        {r.dueAt && (
                          <div>
                            {overdue ? "Overdue since " : "By "}
                            {formatDate(r.dueAt)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {result.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-12 text-center text-slate-500">
                      Nothing in this queue.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            {result.page > 1 ? (
              <Link className={buttonStyles.small} href={`/council${toQuery(current, { page: result.page - 1 })}`}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-slate-600">
              Page {result.page} of {result.pages.toLocaleString()}
            </span>
            {result.page < result.pages ? (
              <Link className={buttonStyles.small} href={`/council${toQuery(current, { page: result.page + 1 })}`}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </div>
        </ActionForm>

        <div className="order-first space-y-5 2xl:order-none 2xl:sticky 2xl:top-20 2xl:self-start">
          <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="map-scope">
            <span className="font-medium text-slate-600">Map shows:</span>
            {[
              { id: "open", label: "Open issues" },
              { id: "all", label: "All reports, including fixed and closed" },
            ].map((o) => (
              <Link
                key={o.id}
                href={`/council${toQuery(current, { status: o.id === "open" ? undefined : o.id, page: undefined })}`}
                className={cx("rounded-full px-2.5 py-1 font-medium", (filters.status === "all" ? "all" : "open") === o.id ? "bg-scc-navy text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50")}
              >
                {o.label}
              </Link>
            ))}
          </div>
          <MapPanel pins={[]} pinsUrl={`/api/council/map/pins${toQuery({ ...current, page: undefined, format: "compact", limit: MAP_PIN_LIMIT })}`} totalCount={result.total} />
          <div className="hidden rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(0,25,60,0.06)] 2xl:block">
            <h2 className="text-sm font-semibold text-scc-navy">Open reports by category</h2>
            <ul className="mt-3 space-y-2">
              {stats.byCategory.map((c) => {
                const max = stats.byCategory[0]?.count || 1;
                return (
                  <li key={c.category}>
                    <Link href={`/council?category=${c.category}`} className="block text-sm hover:text-scc-blue">
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <CategoryIcon category={c.category} className="text-scc-navy/60" />
                          {categoryLabel(c.category)}
                        </span>
                        <span className="tabular-nums text-slate-500">{c.count.toLocaleString()}</span>
                      </span>
                      <span className="mt-1 block h-1.5 rounded-full bg-slate-100">
                        <span className="block h-full rounded-full bg-scc-navy" style={{ width: `${(c.count / max) * 100}%` }} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-slate-500">
              AI queue: {stats.llmQueued.toLocaleString()} awaiting LLM, {stats.visionQueued.toLocaleString()} awaiting image model.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CouncilDashboard({ searchParams }: PageProps<"/council">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}
