import { faArrowRight, faChartColumn, faClipboardCheck, faMagnifyingGlass, faPenToSquare, faScrewdriverWrench } from "@fortawesome/free-solid-svg-icons";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { buttonStyles, cx, inputStyles, Skeleton } from "@/components/ui";
import { publicStats } from "@/lib/repo/reports";

async function Figures() {
  await connection();
  const s = publicStats();
  const items = [
    { label: "Problems fixed in the last year", value: s.fixedThisYear },
    { label: "Reports made in the last 30 days", value: s.reportedThisMonth },
    { label: "Open reports being dealt with", value: s.open },
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      {items.map((i) => (
        <div key={i.label} className="rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(0,25,60,0.06)] ring-1 ring-slate-200">
          <dt className="text-sm text-slate-600">{i.label}</dt>
          <dd className="mt-1 font-display text-3xl font-bold text-scc-navy tabular-nums">{i.value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

export const metadata: Metadata = { title: "Report a street problem" };

const STEPS = [
  { icon: faPenToSquare, title: "Tell us what and where", text: "Choose the type of problem, mark it on the map and add a photo. It takes about two minutes." },
  { icon: faClipboardCheck, title: "We check and prioritise", text: "Reports are checked for duplicates and ranked by danger, so the most urgent problems are dealt with first." },
  { icon: faScrewdriverWrench, title: "Follow it to fixed", text: "See every update from received to fixed. Others can add their support to your report." },
];

/** Resident home: one way into the report form; the category is chosen inside it. */
export default function ResidentHome() {
  return (
    <div className="-mt-8 space-y-12">
      <section className="-mx-4 bg-gradient-to-br from-scc-navy to-scc-navy-2 px-4 py-12 text-white sm:rounded-b-3xl sm:px-10">
        <div className="max-w-3xl">
          <h1 className="font-display text-3xl font-bold leading-tight sm:text-5xl">Report a problem in your street</h1>
          <p className="mt-4 text-lg text-white/85">
            Potholes, fly-tipping, broken street lights, graffiti and more. Tell us once and follow it until it is fixed.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/report" className={buttonStyles.accent}>
              Report a problem <Icon icon={faArrowRight} />
            </Link>
            <Link href="/my-reports" className="inline-flex items-center justify-center gap-2 rounded-md border border-white/40 px-5 py-3 text-base font-semibold text-white hover:bg-white/10">
              Track my reports
            </Link>
          </div>
          <form action="/reports" className="mt-8 flex max-w-xl gap-2" role="search">
            <label htmlFor="home-search" className="sr-only">
              Search existing reports
            </label>
            <input
              id="home-search"
              name="q"
              placeholder="Search by street, problem or reference number"
              className={cx(inputStyles, "border-white/20 py-3 text-base")}
            />
            <button className="inline-flex items-center gap-2 rounded-md bg-white px-4 font-semibold text-scc-navy hover:bg-scc-sand">
              <Icon icon={faMagnifyingGlass} />
              <span className="hidden sm:inline">Search</span>
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_380px]" aria-labelledby="how-heading">
        <div>
          <h2 id="how-heading" className="font-display text-2xl font-bold text-scc-navy">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-scc-magenta font-bold text-white">{i + 1}</span>
                  <Icon icon={s.icon} className="text-xl text-scc-navy" />
                </span>
                <h3 className="mt-3 font-semibold text-scc-navy">{s.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-xl bg-scc-sand p-6 ring-1 ring-slate-200">
          <h2 className="font-display text-xl font-bold text-scc-navy">Track a report</h2>
          <p className="mt-1 text-sm text-slate-600">Enter the reference you were given, for example SR000123.</p>
          <form action="/reports" className="mt-4 flex gap-2">
            <label htmlFor="track-ref" className="sr-only">
              Report reference
            </label>
            <input id="track-ref" name="q" placeholder="Reference number" className={cx(inputStyles, "font-mono uppercase")} />
            <input type="hidden" name="status" value="all" />
            <button className={buttonStyles.primary}>Find</button>
          </form>
          <p className="mt-4 text-sm text-slate-600">
            Made reports before?{" "}
            <Link href="/resident/login" className="font-semibold text-scc-blue underline">
              Sign in to see them all
            </Link>
            .
          </p>
        </div>
      </section>

      <section aria-labelledby="figures-heading">
        <h2 id="figures-heading" className="flex items-center gap-2 font-display text-2xl font-bold text-scc-navy">
          <Icon icon={faChartColumn} className="text-scc-blue" /> Street reports in Southampton
        </h2>
        <div className="mt-6">
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <Figures />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
