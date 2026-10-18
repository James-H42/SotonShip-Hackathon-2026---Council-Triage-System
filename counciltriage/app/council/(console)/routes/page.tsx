import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { MapPanel } from "@/components/map/MapPanel";
import { Card, PageSkeleton, PriorityBadge, Stat, buttonStyles, cx, inputStyles } from "@/components/ui";
import { requireOfficer } from "@/lib/auth";
import { clockTime, minutesToHm } from "@/lib/format";
import { WARD_NAMES } from "@/lib/geo";
import { planForSelectionOnRoads } from "@/lib/repo/workorders";
import { routeOptionsFrom } from "@/lib/route-params";
import { CATEGORIES, categoryLabel } from "@/lib/taxonomy";
import type { PriorityBand } from "@/lib/triage/types";
import { issueWorkOrderAction } from "../actions";

export const metadata: Metadata = { title: "Route planner" };

const CREW_COLOURS = ["#0e7490", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#2563eb", "#9333ea", "#ca8a04"];
const START_HOUR = 8;

type SP = Record<string, string | string[] | undefined>;

function tomorrow() {
  const d = new Date(Date.now() + 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function Planner({ searchParams }: { searchParams: Promise<SP> }) {
  await requireOfficer();
  const sp = await searchParams;
  const planned = sp.plan === "1";
  const wards = (Array.isArray(sp.wards) ? sp.wards : sp.wards ? [sp.wards] : []).filter(Boolean);
  const { selection, options, staff, shiftHours, jobsPerCrew } = routeOptionsFrom({ ...sp, wards });
  const plan = planned ? await planForSelectionOnRoads(selection, options) : null;
  const hiddenParams = (
    <>
      <input type="hidden" name="category" value={selection.category} />
      <input type="hidden" name="minBand" value={selection.minBand} />
      {wards.map((w) => (
        <input key={w} type="hidden" name="wards" value={w} />
      ))}
      <input type="hidden" name="staff" value={staff} />
      <input type="hidden" name="shiftHours" value={shiftHours} />
      <input type="hidden" name="limit" value={selection.limit} />
      <input type="hidden" name="jobsPerCrew" value={jobsPerCrew} />
      {selection.includeReview && <input type="hidden" name="includeReview" value="1" />}
    </>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Route planner</h1>
        <p className="text-sm text-slate-600">
          Pick the work for a day. Each two-person crew gets up to {jobsPerCrew} jobs: it starts at the highest-priority job left, adds the jobs that give
          the most priority for the least extra driving, and visits them in the shortest order. The day starts at the first job.
        </p>
      </div>

      <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4 xl:grid-cols-8" data-testid="route-form">
        <input type="hidden" name="plan" value="1" />
        <label className="xl:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-600">Problem type</span>
          <select name="category" defaultValue={selection.category} className={inputStyles}>
            <option value="all">All problem types</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Minimum priority</span>
          <select name="minBand" defaultValue={selection.minBand} className={inputStyles}>
            <option value="critical">Critical</option>
            <option value="high">High and above</option>
            <option value="medium">Medium and above</option>
            <option value="low">Any</option>
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Repair staff</span>
          <input name="staff" type="number" min={2} max={40} step={2} defaultValue={staff} className={inputStyles} />
          <span className="text-[11px] text-slate-500">Crews of 2 ({staff / 2} crews)</span>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Shift (hours)</span>
          <input name="shiftHours" type="number" min={1} max={12} step={0.5} defaultValue={shiftHours} className={inputStyles} />
        </label>
        <input type="hidden" name="limit" value={selection.limit} />
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-600">Wards (none = whole city)</span>
          <select name="wards" multiple defaultValue={wards} className={cx(inputStyles, "h-20")}>
            {WARD_NAMES.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Jobs per crew</span>
          <select name="jobsPerCrew" defaultValue={String(jobsPerCrew)} className={inputStyles}>
            {[3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} jobs
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
          <input type="checkbox" name="includeReview" value="1" defaultChecked={selection.includeReview} className="h-4 w-4" /> Include reports awaiting review
        </label>
        <div className="flex items-end">
          <button className={cx(buttonStyles.primary, "w-full")}>Plan routes</button>
        </div>
      </form>

      {!plan && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">Choose the work above and select Plan routes.</p>}

      {plan && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Jobs scheduled" value={plan.totals.jobs} hint={`${plan.unassigned.length} did not fit`} />
            <Stat label="Crews" value={plan.crews.length} hint={`${staff} staff`} />
            <Stat
              label="Total driving"
              value={`${plan.totals.km} km`}
              hint={
                plan.crews.some((c) => c.routing === "road")
                  ? `By road · straight-line estimate ${Math.round(plan.crews.reduce((n, c) => n + (c.straightKm ?? c.totalKm), 0) * 10) / 10} km`
                  : "Straight-line estimate"
              }
            />
            <Stat
              label="Priority covered"
              value={`${plan.totals.priorityAvailable ? Math.round((plan.totals.priorityCovered / plan.totals.priorityAvailable) * 100) : 0}%`}
              hint="of the candidate jobs' total priority"
            />
          </div>

          <MapPanel
            pins={plan.crews.flatMap((c) =>
              c.stops.map((s) => ({
                id: s.job.id,
                ref: s.job.ref,
                lat: s.job.lat,
                lon: s.job.lon,
                category: s.job.category,
                priorityBand: s.job.priorityBand as PriorityBand,
                priorityScore: s.job.priorityScore,
                title: s.job.title,
                href: `/council/reports/${s.job.id}`,
              })),
            )}
            routes={plan.crews.map((c) => ({ id: `crew-${c.crew}`, label: `Crew ${c.crew}`, colour: CREW_COLOURS[(c.crew - 1) % CREW_COLOURS.length], path: c.path, roadPath: c.roadPath }))}
            caption={
              plan.crews.some((c) => c.routing === "road")
                ? "Solid lines follow the roads in each crew's visiting order (OpenStreetMap road network). Dark dashed lines are the straight-line legs used to choose the jobs."
                : "Road routing is unavailable, so lines show straight-line legs in each crew's visiting order. Open in Google Maps for turn-by-turn directions."
            }
          />

          <div className="grid gap-5 lg:grid-cols-2" data-testid="crew-routes">
            {plan.crews.map((c) => (
              <Card
                key={c.crew}
                title={
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: CREW_COLOURS[(c.crew - 1) % CREW_COLOURS.length] }} />
                    Crew {c.crew} · {c.stops.length} jobs · {c.totalKm} km {c.routing === "road" ? "by road" : "(straight line)"} · {minutesToHm(c.totalMinutes)}
                  </span>
                }
              >
                {c.stops.length === 0 ? (
                  <p className="text-sm text-slate-500">No jobs fitted in this crew&apos;s shift.</p>
                ) : (
                  <ol className="space-y-2 text-sm">
                    <li className="text-xs text-slate-500">{clockTime(START_HOUR, 0)} start at the first job</li>
                    {c.stops.map((s, i) => (
                      <li key={s.job.id} className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <Link href={`/council/reports/${s.job.id}`} className="font-medium text-slate-900 hover:underline">
                            {s.job.title}
                          </Link>
                          <p className="text-xs text-slate-500">
                            {s.job.ref} · arrive {clockTime(START_HOUR, s.arriveMinute)} · {s.job.jobMinutes} min on site
                            {i > 0 && ` · ${s.legKm} km drive`}
                          </p>
                        </div>
                        <PriorityBadge band={s.job.priorityBand as PriorityBand} score={s.job.priorityScore} />
                      </li>
                    ))}
                    <li className="text-xs text-slate-500">
                      {clockTime(START_HOUR, c.totalMinutes)} finish ({c.travelMinutes} min driving, {c.workMinutes} min on site)
                      {c.routing === "road" && c.straightKm !== undefined && ` · straight-line estimate ${c.straightKm} km`}
                      {c.reordered && " · order changed to suit the roads"}
                    </li>
                  </ol>
                )}
                {c.mapsUrls.length > 0 && (
                  <p className="mt-3 text-xs">
                    Navigation:{" "}
                    {c.mapsUrls.map((u, i) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="mr-2 font-medium text-brand-700 underline">
                        Google Maps{c.mapsUrls.length > 1 ? ` part ${i + 1}` : ""}
                      </a>
                    ))}
                  </p>
                )}
              </Card>
            ))}
          </div>

          {plan.unassigned.length > 0 && (
            <Card title={`Did not fit today (${plan.unassigned.length})`}>
              <p className="text-sm text-slate-600">
                {plan.unassigned
                  .slice(0, 30)
                  .map((j) => j.ref)
                  .join(", ")}
                {plan.unassigned.length > 30 && ` and ${plan.unassigned.length - 30} more`}. Add staff or extend the shift to include them.
              </p>
            </Card>
          )}

          {plan.totals.jobs > 0 && (
            <Card title="Issue to contractor">
              <ActionForm action={issueWorkOrderAction} className="grid gap-3 md:grid-cols-4" testId="issue-form">
                {hiddenParams}
                <label>
                  <span className="mb-1 block text-xs font-medium text-slate-600">Work date</span>
                  <input type="date" name="scheduledFor" defaultValue={tomorrow()} required className={inputStyles} />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium text-slate-600">Contractor</span>
                  <input name="contractor" placeholder="e.g. Highways repair contractor" className={inputStyles} />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium text-slate-600">Contractor email</span>
                  <input name="contractorEmail" type="email" className={inputStyles} />
                </label>
                <label className="md:col-span-4">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Notes for crews</span>
                  <textarea name="notes" rows={2} className={inputStyles} />
                </label>
                <div className="md:col-span-4">
                  <SubmitButton className={buttonStyles.primary}>Create work order for {plan.totals.jobs} jobs</SubmitButton>
                  <p className="mt-2 text-xs text-slate-500">
                    Residents who reported these problems will see &quot;Repair arranged&quot; with the date. The plan is recalculated when you issue it, so it
                    reflects any reports scheduled in the meantime.
                  </p>
                </div>
              </ActionForm>
            </Card>
          )}
          <p className="text-xs text-slate-500">
            Assumes {plan.options.speedKmh} km/h average urban speed and {Math.round((plan.options.detourFactor - 1) * 100)}% extra road distance over straight
            lines. Job times by category: {CATEGORIES.map((c) => `${categoryLabel(c.id)} ${c.typicalJobMinutes} min`).join(", ")}.
          </p>
        </>
      )}
    </div>
  );
}

export default function RoutesPage({ searchParams }: PageProps<"/council/routes">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Planner searchParams={searchParams} />
    </Suspense>
  );
}
