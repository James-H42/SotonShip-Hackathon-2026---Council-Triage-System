/**
 * Built-in AI pipeline for each report (runs after the resident's response is sent):
 *
 *   1. photos -> image model (category, confidence, uncertainty, severity)
 *   2. text   -> local LLM (category, secondary categories, injury, vulnerable, urgency 1-5)
 *   3. retriage: category decision, mismatch review flags, Incident Risk Priority Score
 *   4. merging: nearby same-category candidates the baseline shortlisted are confirmed by
 *      the LLM ("same physical problem?") and merged into the oldest open report. Merged
 *      reports stay in the database individually and remain viewable by officers.
 *
 * Jobs run one at a time (a single local GPU), so a burst of submissions queues up rather
 * than overloading Ollama.
 */
import { degreeRadius, haversineMetres } from "../geo";
import { db } from "../db";
import {
  applyImageAnalysis,
  applyTextAnalysis,
  getPhotos,
  getReport,
  isOpen,
  mergeReports,
  setIntegrationStatus,
  type Report,
} from "../repo/reports";
import { photoPath } from "../uploads";
import { areRelated } from "../triage/text";
import { extractReport, sameProblem, toTextAnalysis, LLM_MODEL } from "./ollama";
import { analysePhotoFile } from "./vision";

/** Same as civic_triage.py --radius (50 m) plus GPS slack. */
export const MERGE_RADIUS_M = 60;

const AI_ACTOR = { type: "ai" as const, name: `Merge assistant (${LLM_MODEL})` };

let chain: Promise<unknown> = Promise.resolve();

/** Queue a report for processing; resolves when it has been processed. */
export function enqueue(reportId: number): Promise<void> {
  const job = chain.then(() => processReport(reportId)).catch((err) => console.error(`[ai] report ${reportId}:`, err));
  chain = job;
  return job as Promise<void>;
}

export async function runVision(report: Report): Promise<boolean> {
  const photos = getPhotos(report.id).filter((p) => !p.analysis);
  if (!photos.length) return true;
  setIntegrationStatus([report.id], "vision_status", "processing");
  try {
    for (const photo of photos) {
      const file = photoPath(photo.fileName);
      if (!file) continue;
      applyImageAnalysis(photo.id, await analysePhotoFile(file, photo.mime, photo.id));
    }
    return true;
  } catch (err) {
    console.error(`[ai] vision failed for ${report.ref}:`, err instanceof Error ? err.message : err);
    setIntegrationStatus([report.id], "vision_status", "failed");
    return false;
  }
}

export async function runLlm(report: Report): Promise<boolean> {
  setIntegrationStatus([report.id], "llm_status", "processing");
  try {
    const x = await extractReport(report.title, report.detail);
    if (!x) {
      setIntegrationStatus([report.id], "llm_status", "failed");
      return false;
    }
    applyTextAnalysis(report.id, toTextAnalysis(x, report.residentCategory));
    return true;
  } catch (err) {
    console.error(`[ai] LLM failed for ${report.ref}:`, err instanceof Error ? err.message : err);
    setIntegrationStatus([report.id], "llm_status", "failed");
    return false;
  }
}

/**
 * Merge `reportId` into an existing incident when the LLM confirms a shortlisted
 * candidate describes the same problem. Returns the canonical id it was merged into.
 */
export async function autoMerge(reportId: number, opts: { incidents?: boolean } = {}): Promise<number | null> {
  const report = getReport(reportId);
  if (!report || !isOpen(report) || report.duplicateOf || !report.triage) return null;
  // On submission, never move a report that already has others merged into it. The batch sweep
  // (`incidents: true`) may join two incidents: the younger one moves into the older.
  const hasMembers = db().prepare("SELECT 1 FROM reports WHERE duplicate_of = ? LIMIT 1").get(reportId);
  if (hasMembers && !opts.incidents) return null;
  // Shortlist by place and kind only: open incidents within MERGE_RADIUS_M of a related category.
  // The LLM then judges the wording, so differently worded reports of one problem still merge.
  const { dLat, dLon } = degreeRadius(MERGE_RADIUS_M, report.lat);
  const nearby = (
    db()
      .prepare(
        `SELECT id FROM reports WHERE is_open = 1 AND duplicate_of IS NULL AND id != ?
         AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 50`,
      )
      .all(report.id, report.lat - dLat, report.lat + dLat, report.lon - dLon, report.lon + dLon) as { id: number }[]
  )
    .map((r) => getReport(Number(r.id))!)
    .map((t) => ({ target: t, distance: haversineMetres(report, t) }))
    .filter(({ distance }) => distance <= MERGE_RADIUS_M)
    .sort((x, y) => x.distance - y.distance)
    .slice(0, 4);
  const dismissed = new Set(
    (db().prepare("SELECT related_id FROM report_links WHERE report_id = ? AND kind = 'not_duplicate'").all(report.id) as { related_id: number }[]).map((r) =>
      Number(r.related_id),
    ),
  );
  for (const { target, distance } of nearby) {
    if (dismissed.has(target.id)) continue;
    if (opts.incidents && new Date(target.createdAt) > new Date(report.createdAt)) continue;
    if (report.category !== "tbc" && !areRelated(target.category, report.category)) continue;
    // Within "other", only compare like with like (flooding vs flooding, not flooding vs a fallen tree).
    const la = report.triage.text?.llmLabel;
    const lb = target.triage?.text?.llmLabel;
    if (report.category === "other" && la && lb && la !== lb) continue;
    const members = db().prepare("SELECT title, detail FROM reports WHERE duplicate_of = ? ORDER BY created_at LIMIT 2").all(target.id) as {
      title: string;
      detail: string;
    }[];
    const incident = {
      title: target.title,
      detail: [target.detail, ...members.map((m) => `Another resident: ${m.title}. ${m.detail}`)].join(" "),
    };
    const verdict = await sameProblem(report, incident, distance);
    if (verdict !== true) continue;
    // Keep the older report as the canonical incident.
    const [dup, canonical] = new Date(report.createdAt) >= new Date(target.createdAt) ? [report, target] : [target, report];
    try {
      mergeReports(dup.id, canonical.id, AI_ACTOR);
      return canonical.id;
    } catch (err) {
      console.error(`[ai] merge ${dup.ref} -> ${canonical.ref} failed:`, err);
    }
  }
  return null;
}

export async function processReport(reportId: number, opts: { merge?: boolean } = {}) {
  const report = getReport(reportId);
  if (!report) return;
  await runVision(report);
  if (report.llmStatus !== "done") await runLlm(getReport(reportId)!);
  if (opts.merge !== false) await autoMerge(reportId);
}
