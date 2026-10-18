import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { MapPanel } from "@/components/map/MapPanel";
import { Card, CategoryTag, FlagChips, PageSkeleton, PriorityBadge, StatusBadge, buttonStyles, cx, inputStyles } from "@/components/ui";
import { requireOfficer } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { getEvents, getLinkedReports, getPhotos, getReport, photoUrl, queueNeighbours } from "@/lib/repo/reports";
import { parseSearchParams, toQuery } from "@/lib/search-params";
import { Icon } from "@/components/icons";
import { faArrowLeft, faArrowRight, faCircleCheck, faEye, faPlay, faRoute, faXmark } from "@fortawesome/free-solid-svg-icons";
import { STATUSES } from "@/lib/statuses";
import type { ImageAnalysis, PriorityResult } from "@/lib/triage/types";
import { CATEGORIES, HAZARD_LEVELS, categoryLabel, describeAnswers } from "@/lib/taxonomy";
import {
  dismissDuplicateAction,
  mergeAction,
  moderationAction,
  unmergeAction,
  noteAction,
  overrideCategoryAction,
  overridePriorityAction,
  retriageAction,
  setStatusAction,
} from "../../actions";

export const metadata: Metadata = { title: "Report review" };

const ACTOR_TONE: Record<string, string> = {
  officer: "bg-sky-100 text-sky-800",
  ai: "bg-violet-100 text-violet-800",
  system: "bg-slate-100 text-slate-700",
  resident: "bg-emerald-100 text-emerald-800",
};

type SP = Record<string, string | string[] | undefined>;

const QUICK_STATUSES = [
  { status: "in_progress", label: "Start processing", icon: faPlay },
  { status: "monitoring", label: "Monitor", icon: faEye },
  { status: "completed", label: "Mark fixed", icon: faCircleCheck },
  { status: "closed", label: "Close", icon: faXmark },
] as const;

async function ReportDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireOfficer();
  const { id } = await params;
  const sp = await searchParams;
  const report = getReport(Number(id));
  if (!report) notFound();
  const current = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const queryString = toQuery(current);
  const nav = queueNeighbours(parseSearchParams(sp), report.id);
  const photos = getPhotos(report.id);
  const events = getEvents(report.id).reverse();
  const links = getLinkedReports(report.id);
  const triage = report.triage;
  const contact = report.residentId
    ? (db().prepare("SELECT first_name, last_name, email, phone FROM residents WHERE id = ?").get(report.residentId) as
        | { first_name: string; last_name: string; email: string; phone: string | null }
        | undefined)
    : undefined;
  const answers = describeAnswers(report.residentCategory, report.answers);
  const hidden = <input type="hidden" name="reportId" value={report.id} />;

  return (
    <div className="space-y-5">
      <div>
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <Link href={`/council${queryString}`} className={buttonStyles.ghost}>
            <Icon icon={faArrowLeft} /> Back to queue
          </Link>
          <div className="flex items-center gap-2 text-sm text-slate-600" data-testid="queue-nav">
            {nav.position && (
              <span>
                {nav.position.toLocaleString()} of {nav.total.toLocaleString()} in this queue
              </span>
            )}
            {nav.prevId && (
              <Link href={`/council/reports/${nav.prevId}${queryString}`} className={buttonStyles.small}>
                Previous
              </Link>
            )}
            {nav.nextId && (
              <Link href={`/council/reports/${nav.nextId}${queryString}`} className={buttonStyles.smallPrimary}>
                Next in queue <Icon icon={faArrowRight} />
              </Link>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-slate-500">{report.ref}</p>
            <h1 className="text-2xl font-semibold text-slate-900">{report.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <PriorityBadge band={report.priorityBand} score={report.priorityScore} />
              <StatusBadge status={report.status} audience="officer" />
              <CategoryTag category={report.category} service={report.serviceName} />
              {report.dubious && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Dubious</span>}
              {report.needsReview && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Needs review</span>}
            </div>
          </div>
          <div className="text-right text-sm text-slate-600">
            <p>Reported {formatDateTime(report.createdAt)}</p>
            <p>
              Target: <strong>{report.responseTarget ?? "-"}</strong>
              {report.dueAt && ` (by ${formatDate(report.dueAt)})`}
            </p>
            <p className="text-xs">
              {report.source === "fixmystreet" ? (
                <a href={report.externalUrl ?? "#"} target="_blank" rel="noreferrer" className="underline">
                  FixMyStreet import
                </a>
              ) : (
                "Submitted on StreetTriage"
              )}
              {" · "}
              <Link href={`/reports/${report.ref}`} className="underline">
                Public page
              </Link>
            </p>
          </div>
        </div>
      </div>

      {report.status !== "duplicate" && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,25,60,0.06)]" data-testid="quick-actions">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Quick actions</span>
          {QUICK_STATUSES.filter((q) => q.status !== report.status).map((q) => (
            <ActionForm key={q.status} action={setStatusAction}>
              {hidden}
              <input type="hidden" name="status" value={q.status} />
              <SubmitButton className={q.status === "completed" ? buttonStyles.smallPrimary : buttonStyles.small}>
                <Icon icon={q.icon} /> {q.label}
              </SubmitButton>
            </ActionForm>
          ))}
          <Link href={`/council/routes?plan=1&category=${report.category === "tbc" ? report.residentCategory : report.category}`} className={buttonStyles.small}>
            <Icon icon={faRoute} /> Arrange repair
          </Link>
          <span className="ml-auto text-xs text-slate-500">Residents are notified of status changes.</span>
        </div>
      )}

      {links.mergedInto && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          Merged into{" "}
          <Link className="font-semibold underline" href={`/council/reports/${links.mergedInto.id}`}>
            {links.mergedInto.ref}: {links.mergedInto.title}
          </Link>
          .
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Card title="Report">
            <p className="whitespace-pre-line text-slate-800">{report.detail}</p>
            <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[180px_1fr]">
              <dt className="text-slate-500">Resident category</dt>
              <dd>
                {categoryLabel(report.residentCategory)} · {report.serviceName}
                {report.customType && ` · "${report.customType}"`}
              </dd>
              {answers.map((a) => (
                <div key={a.question} className="contents">
                  <dt className="text-slate-500">{a.question}</dt>
                  <dd>{a.answer}</dd>
                </div>
              ))}
              {report.hazardLevel && (
                <>
                  <dt className="text-slate-500">Resident severity</dt>
                  <dd>{HAZARD_LEVELS.find((h) => h.value === report.hazardLevel)?.label}</dd>
                </>
              )}
              <dt className="text-slate-500">Location</dt>
              <dd>
                <span className="font-mono">
                  {report.lat.toFixed(6)}, {report.lon.toFixed(6)}
                </span>
                {report.locationPrecision === "approximate" && <span className="ml-1 font-semibold text-amber-800">(approximate)</span>}
                {report.locationSource === "photo" && <span className="ml-1 text-slate-500">(from photo GPS)</span>} · {report.ward ?? "Outside wards"}
                {report.geoContext.majorRoad && (
                  <span className="text-slate-500">
                    {" "}
                    · {report.geoContext.majorRoad.distanceMetres}m from {report.geoContext.majorRoad.name}
                  </span>
                )}
                {report.locationText && <span className="block text-slate-700">{report.locationText}</span>}
              </dd>
              {contact && (
                <>
                  <dt className="text-slate-500">Reporter</dt>
                  <dd>
                    {contact.first_name} {contact.last_name} · <a href={`mailto:${contact.email}`} className="underline">{contact.email}</a>
                    {contact.phone && ` · ${contact.phone}`}
                  </dd>
                </>
              )}
            </dl>
            {photos.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {photos.map((p) => (
                  <figure key={p.id} className="w-44">
                    <a href={photoUrl(p.id)} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photoUrl(p.id)} alt="Report photo" className="h-44 w-44 rounded-lg border border-slate-200 object-cover" />
                    </a>
                    <figcaption className="mt-1 text-xs text-slate-500">
                      <PhotoAnalysisCaption analysis={p.analysis} status={report.visionStatus} />
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </Card>

          <MapPanel
            pins={[
              { id: report.id, ref: report.ref, lat: report.lat, lon: report.lon, category: report.category, priorityBand: report.priorityBand, title: report.title },
              ...links.suggested.map((l) => ({
                id: l.report.id,
                ref: l.report.ref,
                lat: l.report.lat,
                lon: l.report.lon,
                category: l.report.category,
                priorityBand: l.report.priorityBand,
                title: l.report.title,
                href: `/council/reports/${l.report.id}`,
              })),
            ]}
            selectedId={report.id}
           
            caption="This report (outlined) and nearby possible duplicates."
          />

          {links.merged.length > 0 && (
            <Card title={`Merged incident: ${links.merged.length + 1} reports of this problem`}>
              <p className="text-sm text-slate-600">
                These reports are shown as one incident in the queue and on the map, but each is stored separately with its own text, photos and
                AI assessment.
                {triage?.priority.risk && (
                  <>
                    {" "}
                    Incident totals: {Math.round(triage.priority.risk.injuriesPerWeek * 10) / 10} injur
                    {triage.priority.risk.injuriesPerWeek === 1 ? "y" : "ies"} per week.
                  </>
                )}
              </p>
              <ol className="mt-3 space-y-3" data-testid="merged-reports">
                {links.merged.map((m) => {
                  const mt = m.report.triage?.text;
                  const mPhotos = getPhotos(m.report.id);
                  return (
                    <li key={m.report.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <Link href={`/council/reports/${m.report.id}`} className="font-medium text-slate-900 hover:underline">
                          {m.report.ref}: {m.report.title}
                        </Link>
                        <span className="flex items-center gap-2 text-xs text-slate-500">
                          reported {formatDate(m.report.createdAt)}
                          <ActionForm action={unmergeAction}>
                            <input type="hidden" name="duplicateId" value={m.report.id} />
                            <SubmitButton className={buttonStyles.small}>Unmerge</SubmitButton>
                          </ActionForm>
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{m.report.detail}</p>
                      {mt && (
                        <p className="mt-1 text-xs text-slate-500">
                          {mt.source === "llm" ? "LLM" : "Keywords"}: {categoryLabel(mt.category === "tbc" ? m.report.residentCategory : mt.category)}
                          {typeof mt.urgency === "number" && ` · urgency ${mt.urgency}/5`}
                          {mt.injury && " · injury reported"}
                          {mt.vulnerable && " · vulnerable people"}
                        </p>
                      )}
                      {mPhotos.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-3">
                          {mPhotos.map((p) => (
                            <figure key={p.id} className="w-32">
                              <a href={photoUrl(p.id)} target="_blank" rel="noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={photoUrl(p.id)} alt={`Photo from ${m.report.ref}`} className="h-32 w-32 rounded-lg border border-slate-200 object-cover" />
                              </a>
                              <figcaption className="mt-1 text-[11px] text-slate-500">
                                <PhotoAnalysisCaption analysis={p.analysis} status={m.report.visionStatus} />
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}

          <Card title={`Duplicates (${links.suggested.length} suggested, ${links.merged.length} merged)`}>
            {links.suggested.length === 0 && links.merged.length === 0 && <p className="text-sm text-slate-500">No likely duplicates found nearby.</p>}
            {links.suggested.length > 0 && (
              <ul className="space-y-2" data-testid="suggested-duplicates">
                {links.suggested.map((l) => (
                  <li key={l.report.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/council/reports/${l.report.id}`} className="font-medium text-slate-900 hover:underline">
                          {l.report.ref}: {l.report.title}
                        </Link>
                        <p className="text-xs text-slate-500">
                          Match {Math.round((l.score ?? 0) * 100)}% · {l.distanceMetres !== null && l.distanceMetres >= 0 ? `${l.distanceMetres}m away` : "suggested by LLM"} · reported{" "}
                          {formatDate(l.report.createdAt)} · <StatusBadge status={l.report.status} audience="officer" />
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <ActionForm action={mergeAction}>
                          <input type="hidden" name="duplicateId" value={l.report.id} />
                          <input type="hidden" name="canonicalId" value={report.id} />
                          <SubmitButton className={buttonStyles.small}>Merge into this report</SubmitButton>
                        </ActionForm>
                        <ActionForm action={mergeAction}>
                          <input type="hidden" name="duplicateId" value={report.id} />
                          <input type="hidden" name="canonicalId" value={l.report.id} />
                          <SubmitButton className={buttonStyles.small}>Merge this into {l.report.ref}</SubmitButton>
                        </ActionForm>
                        <ActionForm action={dismissDuplicateAction}>
                          {hidden}
                          <input type="hidden" name="relatedId" value={l.report.id} />
                          <SubmitButton className={buttonStyles.small}>Not a duplicate</SubmitButton>
                        </ActionForm>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {links.merged.length > 0 && (
              <div className="mt-3 text-sm">
                <p className="font-medium text-slate-700">Merged into this report:</p>
                <p className="text-slate-600">
                  {links.merged.map((m, i) => (
                    <span key={m.report.id}>
                      {i > 0 && ", "}
                      <Link href={`/council/reports/${m.report.id}`} className="underline">
                        {m.report.ref}
                      </Link>
                    </span>
                  ))}
                </p>
              </div>
            )}
            {!report.duplicateOf && (
              <ActionForm action={mergeAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="duplicateId" value={report.id} />
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-slate-600">Merge this report into another (reference)</span>
                  <input name="canonicalRef" placeholder="FMS1234567 or SR000001" className={cx(inputStyles, "w-56 py-1.5")} />
                </label>
                <SubmitButton className={buttonStyles.small}>Merge</SubmitButton>
              </ActionForm>
            )}
          </Card>

          <Card title="Timeline">
            <ol className="space-y-3" data-testid="officer-timeline">
              {events.map((e) => (
                <li key={e.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{formatDateTime(e.createdAt)}</span>
                    <span className={cx("rounded px-1.5 py-0.5 font-medium", ACTOR_TONE[e.actorType])}>
                      {e.actorType}
                      {e.actorName && `: ${e.actorName}`}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">{e.kind}</span>
                    <span className={e.isPublic ? "text-emerald-700" : "text-slate-400"}>{e.isPublic ? "visible to residents" : "internal"}</span>
                  </div>
                  {e.message && <p className="mt-0.5 text-slate-800">{e.message}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-5">
          <Card
            title="AI triage"
            actions={
              <ActionForm action={retriageAction}>
                {hidden}
                <SubmitButton className={buttonStyles.small}>Re-run</SubmitButton>
              </ActionForm>
            }
          >
            {triage ? (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</p>
                  <p className="mt-1">
                    <CategoryTag category={triage.category.category} />{" "}
                    <span className="text-slate-600">{Math.round(triage.category.confidence * 100)}% confidence · {triage.category.source}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{triage.category.reason}</p>
                  {triage.category.suggested && triage.category.suggested !== triage.category.category && (
                    <p className="mt-1 text-xs text-slate-700">Alternative: {categoryLabel(triage.category.suggested)}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Priority {triage.priority.score}/100</p>
                  <table className="mt-1 w-full text-xs" data-testid="priority-factors">
                    <tbody>
                      {triage.priority.factors.map((f, i) => (
                        <tr key={i} className="border-b border-slate-100 last:border-0">
                          <td className="py-1 pr-2 text-slate-700">
                            {f.factor}
                            {f.detail && <span className="block text-slate-400">{f.detail}</span>}
                          </td>
                          <td className={cx("py-1 text-right font-mono", f.points < 0 ? "text-red-700" : "text-slate-900")}>
                            {f.points > 0 ? "+" : ""}
                            {f.points}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {triage.priority.risk && <RiskTerms risk={triage.priority.risk} />}
                {triage.text?.source === "llm" && (
                  <p className="text-xs text-slate-700" data-testid="llm-extraction">
                    LLM extraction: urgency {triage.text.urgency ?? "-"}/5 · injury {triage.text.injury ? "yes" : "no"} · vulnerable people{" "}
                    {triage.text.vulnerable ? "yes" : "no"}
                    {triage.text.llmLabel && ` · "${triage.text.llmLabel}"`}
                  </p>
                )}
                {triage.flags.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Flags</p>
                    <div className="mt-1">
                      <FlagChips flags={triage.flags} />
                    </div>
                  </div>
                )}
                {triage.reviewReasons.length > 0 && (
                  <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">Review needed: {triage.reviewReasons.join("; ")}</p>
                )}
                {triage.text?.keyFeatures.length ? <p className="text-xs text-slate-600">Key features: {triage.text.keyFeatures.join(", ")}</p> : null}
                {triage.text?.summary && <p className="text-xs text-slate-600">LLM summary: {triage.text.summary}</p>}
                <p className="text-xs text-slate-500">
                  Text model: {triage.text?.model ?? "-"} ({report.llmStatus}) · Image model: {report.visionStatus} · computed {formatDateTime(triage.computedAt)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Not triaged yet.</p>
            )}
          </Card>

          <Card title="Update status">
            <ActionForm action={setStatusAction} className="space-y-2" testId="status-form">
              {hidden}
              <select name="status" defaultValue={report.status === "duplicate" ? "closed" : report.status} className={inputStyles} aria-label="Status">
                {STATUSES.filter((s) => s.id !== "duplicate").map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.officerLabel}
                  </option>
                ))}
              </select>
              <textarea name="message" rows={2} placeholder="Message for the resident (optional; a default is used)" className={inputStyles} />
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" name="internal" className="h-4 w-4" /> Internal only (do not show to residents)
              </label>
              <SubmitButton className={buttonStyles.primary}>Save status</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Human review">
            <div className="space-y-4">
              <ActionForm action={overrideCategoryAction} className="space-y-2" testId="category-form">
                {hidden}
                <label className="block text-xs font-medium text-slate-600">
                  Category{report.officerCategory && <span className="ml-1 text-sky-700">(officer set)</span>}
                  <select name="category" defaultValue={report.officerCategory ?? report.category} className={cx(inputStyles, "mt-1")}>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                    <option value="tbc">TBC (needs review)</option>
                  </select>
                </label>
                <div className="flex gap-2">
                  <SubmitButton className={buttonStyles.small}>Confirm category</SubmitButton>
                </div>
              </ActionForm>
              {report.officerCategory && (
                <ActionForm action={overrideCategoryAction}>
                  {hidden}
                  <input type="hidden" name="category" value="" />
                  <SubmitButton className={buttonStyles.ghost}>Let AI decide category again</SubmitButton>
                </ActionForm>
              )}

              <ActionForm action={overridePriorityAction} className="space-y-2 border-t border-slate-100 pt-3" testId="priority-form">
                {hidden}
                <div className="flex items-end gap-2">
                  <label className="text-xs font-medium text-slate-600">
                    Priority (0-100){report.priorityOverride !== null && <span className="ml-1 text-sky-700">(officer set)</span>}
                    <input name="score" type="number" min={0} max={100} defaultValue={report.priorityScore} className={cx(inputStyles, "mt-1 w-24")} />
                  </label>
                  <input name="reason" placeholder="Reason" className={cx(inputStyles, "flex-1")} aria-label="Reason for priority change" />
                </div>
                <div className="flex gap-2">
                  <SubmitButton className={buttonStyles.small}>Set priority</SubmitButton>
                  {report.priorityOverride !== null && (
                    <SubmitButton className={buttonStyles.ghost} name="clear" value="1">
                      Clear override
                    </SubmitButton>
                  )}
                </div>
              </ActionForm>

              <ActionForm action={moderationAction} className="flex flex-wrap gap-2 border-t border-slate-100 pt-3" testId="moderation-form">
                {hidden}
                <SubmitButton className={buttonStyles.small} name="moderation" value="genuine">
                  Confirm genuine
                </SubmitButton>
                <SubmitButton className={buttonStyles.small} name="moderation" value="dubious">
                  Mark dubious
                </SubmitButton>
                {report.moderation && (
                  <SubmitButton className={buttonStyles.ghost} name="moderation" value="">
                    Clear ({report.moderation})
                  </SubmitButton>
                )}
              </ActionForm>
              <p className="text-xs text-slate-500">Every override is recorded as training feedback for the AI models.</p>
            </div>
          </Card>

          <Card title="Add a note">
            <ActionForm action={noteAction} className="space-y-2">
              {hidden}
              <textarea name="note" rows={2} className={inputStyles} placeholder="Note" aria-label="Note" />
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" name="public" className="h-4 w-4" /> Show this note to residents
              </label>
              <SubmitButton className={buttonStyles.small}>Add note</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PhotoAnalysisCaption({ analysis, status }: { analysis: ImageAnalysis | null; status: string }) {
  if (!analysis) return <>Image model: {status}</>;
  return (
    <>
      Image model: {analysis.category ? categoryLabel(analysis.category) : "no issue"} ({Math.round(analysis.categoryConfidence * 100)}%)
      {typeof analysis.uncertainty === "number" && <>, uncertainty {analysis.uncertainty.toFixed(2)}</>}
      {analysis.severityLabel && <>, {analysis.severityLabel} severity</>}
    </>
  );
}

function RiskTerms({ risk }: { risk: NonNullable<PriorityResult["risk"]> }) {
  const pc = (n: number | null) => (n === null ? "no image" : `${Math.round(n * 100)}%`);
  const rows: [string, string][] = [
    ["S' text severity", pc(risk.textSeverity)],
    ["St' image severity", pc(risk.imageSeverity)],
    ["sev = max(S', St')", pc(risk.severity)],
    ["d to key road", risk.roadDistanceMetres === null ? "> 2 km" : `${Math.round(risk.roadDistanceMetres)} m`],
    ["λ = 0.5^(d/100) × sev", pc(risk.roadImpact)],
    ["i' injuries", `${Math.round(risk.injuriesPerWeek * 10) / 10}/week → ${pc(risk.injuryTerm)}`],
    ["c vulnerable", pc(risk.vulnerableTerm)],
    ["r corroboration", pc(risk.volumeTerm)],
  ];
  return (
    <details className="rounded-md bg-slate-50 p-2 text-xs" data-testid="risk-terms">
      <summary className="cursor-pointer font-medium text-slate-700">
        Incident Risk Priority Score: {risk.raw.toFixed(2)} {risk.imageSeverity === null ? "(text-only weights)" : "(with-image weights)"}
      </summary>
      <table className="mt-1 w-full">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="py-0.5 pr-2 text-slate-600">{k}</td>
              <td className="py-0.5 text-right font-mono text-slate-900">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {risk.override && <p className="mt-1 font-medium text-red-800">Override: {risk.override}</p>}
    </details>
  );
}

export default function OfficerReportPage({ params, searchParams }: PageProps<"/council/reports/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReportDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}
