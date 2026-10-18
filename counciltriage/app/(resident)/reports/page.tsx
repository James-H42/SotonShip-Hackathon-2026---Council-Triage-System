import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ReportCard } from "@/components/resident";
import { PageSkeleton, buttonStyles, cx, inputStyles } from "@/components/ui";
import { WARD_NAMES } from "@/lib/geo";
import { getResident } from "@/lib/auth";
import { publicReport } from "@/lib/public";
import { reportSummary } from "@/lib/public-summary";
import { searchReports } from "@/lib/repo/reports";
import { parseSearchParams, toQuery } from "@/lib/search-params";
import { CATEGORIES } from "@/lib/taxonomy";
import { NearMeButton } from "./NearMeButton";

export const metadata: Metadata = { title: "Search reports" };

type SP = Record<string, string | string[] | undefined>;

async function Results({ searchParams }: { searchParams: Promise<SP> }) {
  await connection();
  const sp = await searchParams;
  const filters = parseSearchParams(sp, { defaultSort: "newest" });
  const result = searchReports({ ...filters, publicOnly: true, pageSize: 20 });
  // Other people's reports show only the privacy-safe summary; a signed-in resident sees their own in full.
  const residentId = (await getResident())?.residentId ?? null;
  const base = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

  return (
    <>
      <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-6" role="search">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-600">Search</span>
          <input name="q" defaultValue={filters.q} placeholder="Street, problem or reference" className={inputStyles} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Type</span>
          <select name="category" defaultValue={filters.category ?? ""} className={inputStyles}>
            <option value="">All types</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Area</span>
          <select name="ward" defaultValue={filters.ward ?? ""} className={inputStyles}>
            <option value="">All wards</option>
            {WARD_NAMES.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Status</span>
          <select name="status" defaultValue={filters.status} className={inputStyles}>
            <option value="open">Open</option>
            <option value="closed">Fixed or closed</option>
            <option value="all">All</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          {filters.near && <input type="hidden" name="near" value={`${filters.near.lat},${filters.near.lon}`} />}
          <button className={cx(buttonStyles.primary, "w-full")}>Search</button>
        </div>
      </form>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600" data-testid="result-count">
          {result.total.toLocaleString()} report{result.total === 1 ? "" : "s"}
          {filters.near && " near you"}
        </p>
        <NearMeButton />
      </div>
      {result.items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          No reports match. <Link href="/report" className="font-medium text-brand-700 underline">Report a new problem</Link>.
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {result.items.map((r) => (
            <ReportCard key={r.id} report={residentId !== null && r.residentId === residentId ? publicReport(r) : reportSummary(r)} />
          ))}
        </ul>
      )}
      {result.pages > 1 && (
        <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
          {result.page > 1 ? (
            <Link className={buttonStyles.secondary} href={`/reports${toQuery(base, { page: result.page - 1 })}`}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-slate-600">
            Page {result.page} of {result.pages.toLocaleString()}
          </span>
          {result.page < result.pages ? (
            <Link className={buttonStyles.secondary} href={`/reports${toQuery(base, { page: result.page + 1 })}`}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">Search reports</h1>
      <p className="mt-1 mb-6 text-slate-600">
        See what has already been reported in your area and how the council is dealing with it. To protect reporters&apos; privacy, only the type of
        problem, rough location and progress are shown.
      </p>
      <Suspense fallback={<PageSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
