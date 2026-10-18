import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProgressSteps } from "@/components/resident";
import { PageSkeleton, StatusBadge } from "@/components/ui";
import { getResident } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { publicEvent, publicReport } from "@/lib/public";
import { reportSummary, summaryEvent } from "@/lib/public-summary";
import { getEvents, getReportByRef } from "@/lib/repo/reports";
import { describeAnswers } from "@/lib/taxonomy";
import { SupportPanel } from "./SupportPanel";

export const metadata: Metadata = { title: "Report" };

async function ReportView({ params }: { params: Promise<{ ref: string }> }) {
  await connection();
  const { ref } = await params;
  const report = getReportByRef(ref);
  if (!report) notFound();
  const resident = await getResident();
  // The reporter sees everything they sent; everyone else sees only the privacy-safe summary.
  const own = resident !== null && report.residentId === resident.residentId;
  const pub = reportSummary(report);
  const full = own ? publicReport(report, { withPhotos: true }) : null;
  const events = getEvents(report.id, { publicOnly: true });
  const timeline = (own ? events.map(publicEvent) : events.map(summaryEvent)).reverse();
  const answers = own ? describeAnswers(report.residentCategory, report.answers) : [];

  return (
    <article className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <div>
          <p className="text-sm text-slate-500">
            <Link href="/reports" className="text-brand-700 hover:underline">
              Reports
            </Link>{" "}
            / {pub.ref}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 sm:text-3xl">{full?.title ?? pub.title}</h1>
          {own && <p className="mt-1 text-sm font-medium text-emerald-800">This is your report, so you can see everything you sent.</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <StatusBadge status={pub.status} />
            <span>{pub.categoryLabel}</span>
            <span>·</span>
            <span>Reported {formatDate(pub.createdAt)}</span>
            {pub.supporters > 0 && (
              <>
                <span>·</span>
                <span>{pub.supporters + 1} people have reported this</span>
              </>
            )}
          </div>
        </div>

        {pub.mergedInto && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
            This problem had already been reported. Follow progress on{" "}
            <Link href={`/reports/${pub.mergedInto.ref}`} className="font-semibold underline">
              {pub.mergedInto.ref}: {pub.mergedInto.title}
            </Link>
            .
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ProgressSteps status={pub.status} />
          {pub.open && pub.responseTarget && pub.status !== "monitoring" && (
            <p className="mt-4 text-sm text-slate-600">
              Target response: <strong>{pub.responseTarget}</strong>
            </p>
          )}
          {full ? (
            <p className="mt-4 whitespace-pre-line text-slate-800">{full.detail}</p>
          ) : (
            <p className="mt-4 text-sm text-slate-600" data-testid="privacy-note">
              The description and photos are only shown to the person who reported it and to council staff.
            </p>
          )}
          {answers.length > 0 && (
            <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              {answers.map((a) => (
                <div key={a.question} className="contents">
                  <dt className="text-slate-500">{a.question}</dt>
                  <dd className="text-slate-800">{a.answer}</dd>
                </div>
              ))}
            </dl>
          )}
          {full && full.photos.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {full.photos.map((src) => (
                <a key={src} href={src} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Photo of ${pub.title}`} className="h-40 w-40 rounded-lg border border-slate-200 object-cover" />
                </a>
              ))}
            </div>
          )}
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">Updates</h2>
          <ol className="mt-3 space-y-4 border-l-2 border-slate-200 pl-4" data-testid="timeline">
            {timeline.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[23px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-600" />
                <p className="text-xs text-slate-500">
                  {formatDateTime(e.at)} · {e.by}
                  {e.statusLabel && <> · {e.statusLabel}</>}
                </p>
                {e.message && <p className="text-sm text-slate-800">{e.message}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold text-slate-900">Location</h2>
          <p className="mt-1 text-slate-700">{pub.approxLocation}</p>
          {full ? (
            <>
              {full.locationText && <p className="mt-1 text-slate-700">{full.locationText}</p>}
              <p className="mt-1 font-mono text-xs text-slate-500">
                {full.lat.toFixed(5)}, {full.lon.toFixed(5)}
                {full.locationPrecision === "approximate" && " (approximate)"}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Approximate location</p>
          )}
          {own && report.source === "fixmystreet" && report.externalUrl && (
            <p className="mt-3 text-xs text-slate-500">
              Imported from{" "}
              <a href={report.externalUrl} className="underline" target="_blank" rel="noreferrer">
                FixMyStreet
              </a>
              .
            </p>
          )}
        </div>
        {pub.open && !pub.mergedInto && <SupportPanel reportRef={pub.ref} signedInEmail={resident?.email ?? null} />}
      </aside>
    </article>
  );
}

export default function PublicReportPage({ params }: PageProps<"/reports/[ref]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReportView params={params} />
    </Suspense>
  );
}
