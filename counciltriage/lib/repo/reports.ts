/** Report data access: creation, triage application, search and moderation. */
import crypto from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import { RESIDENT_ID_OFFSET } from "../config";
import { db, nowIso, parseJson, transaction } from "../db";
import { degreeRadius, nearestMajorRoad, wardFor } from "../geo";
import { STATUS_BY_ID, statusToFixMyStreet, type ReportStatus } from "../statuses";
import {
  CATEGORY_BY_ID,
  potholeClass,
  describeAnswers,
  type Answers,
  type CategoryId,
  type EffectiveCategoryId,
  type HazardLevel,
} from "../taxonomy";
import { buildTriageRecord } from "../triage/combine";
import { DUPLICATE_RADIUS_M, DUPLICATE_THRESHOLD, duplicateScore } from "../triage/duplicates";
import { analyseText } from "../triage/text";
import type { ClusterStats, DuplicateCandidate, Flag, GeoContext, ImageAnalysis, PriorityBand, TextAnalysis, TriageInput, TriageRecord } from "../triage/types";

export type Report = {
  id: number;
  ref: string;
  source: "resident" | "fixmystreet";
  externalUrl: string | null;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
  title: string;
  detail: string;
  locationText: string | null;
  lat: number;
  lon: number;
  locationPrecision: "exact" | "approximate";
  locationSource: "map" | "photo";
  ward: string | null;
  residentCategory: CategoryId;
  serviceName: string;
  customType: string | null;
  answers: Answers;
  hazardLevel: HazardLevel | null;
  potholeClass: string | null;
  hasPhoto: boolean;
  inSample: boolean;
  residentId: number | null;
  category: EffectiveCategoryId;
  categorySource: string;
  categoryConfidence: number | null;
  suggestedCategory: EffectiveCategoryId | null;
  priorityScore: number;
  priorityBand: PriorityBand;
  responseTarget: string | null;
  dueAt: string | null;
  needsReview: boolean;
  dubious: boolean;
  flags: Flag[];
  triage: TriageRecord | null;
  triageSource: string;
  officerCategory: EffectiveCategoryId | null;
  priorityOverride: number | null;
  moderation: "dubious" | "genuine" | null;
  llmStatus: string;
  visionStatus: string;
  duplicateOf: number | null;
  supporters: number;
  workOrderId: number | null;
  geoContext: GeoContext;
};

export type ReportPhoto = { id: number; reportId: number; fileName: string; mime: string; bytes: number | null; analysis: ImageAnalysis | null };

export type ReportEvent = {
  id: number;
  reportId: number;
  createdAt: string;
  kind: string;
  status: ReportStatus | null;
  message: string | null;
  isPublic: boolean;
  actorType: "system" | "ai" | "officer" | "resident";
  actorName: string | null;
  data: Record<string, unknown> | null;
};

export type Actor = { type: ReportEvent["actorType"]; name?: string | null; officerId?: number | null };

type Row = Record<string, SQLInputValue>;

function toReport(r: Row): Report {
  return {
    id: Number(r.id),
    ref: String(r.ref),
    source: r.source as Report["source"],
    externalUrl: (r.external_url as string) ?? null,
    status: r.status as ReportStatus,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    title: String(r.title),
    detail: String(r.detail),
    locationText: (r.location_text as string) ?? null,
    lat: Number(r.lat),
    lon: Number(r.lon),
    locationPrecision: (r.location_precision as Report["locationPrecision"]) ?? "exact",
    locationSource: r.location_source === "photo" ? "photo" : "map",
    ward: (r.ward as string) ?? null,
    residentCategory: r.resident_category as CategoryId,
    serviceName: String(r.service_name),
    customType: (r.custom_type as string) ?? null,
    answers: parseJson<Answers>(r.answers, {}),
    hazardLevel: (r.hazard_level as HazardLevel) ?? null,
    potholeClass: (r.pothole_class as string) ?? null,
    hasPhoto: Boolean(r.has_photo),
    inSample: Boolean(r.in_sample),
    residentId: r.resident_id === null || r.resident_id === undefined ? null : Number(r.resident_id),
    category: r.category as EffectiveCategoryId,
    categorySource: String(r.category_source),
    categoryConfidence: r.category_confidence === null ? null : Number(r.category_confidence),
    suggestedCategory: (r.suggested_category as EffectiveCategoryId) ?? null,
    priorityScore: Number(r.priority_score),
    priorityBand: r.priority_band as PriorityBand,
    responseTarget: (r.response_target as string) ?? null,
    dueAt: (r.due_at as string) ?? null,
    needsReview: Boolean(r.needs_review),
    dubious: Boolean(r.dubious),
    flags: parseJson<Flag[]>(r.flags, []),
    triage: parseJson<TriageRecord | null>(r.triage, null),
    triageSource: String(r.triage_source),
    officerCategory: (r.officer_category as EffectiveCategoryId) ?? null,
    priorityOverride: r.priority_override === null || r.priority_override === undefined ? null : Number(r.priority_override),
    moderation: (r.moderation as Report["moderation"]) ?? null,
    llmStatus: String(r.llm_status),
    visionStatus: String(r.vision_status),
    duplicateOf: r.duplicate_of === null || r.duplicate_of === undefined ? null : Number(r.duplicate_of),
    supporters: Number(r.supporters ?? 0),
    workOrderId: r.work_order_id === null || r.work_order_id === undefined ? null : Number(r.work_order_id),
    geoContext: parseJson<GeoContext>(r.geo_context, {}),
  };
}

function toPhoto(r: Row): ReportPhoto {
  return {
    id: Number(r.id),
    reportId: Number(r.report_id),
    fileName: String(r.file_name),
    mime: String(r.mime),
    bytes: r.bytes === null ? null : Number(r.bytes),
    analysis: parseJson<ImageAnalysis | null>(r.analysis, null),
  };
}

function toEvent(r: Row): ReportEvent {
  return {
    id: Number(r.id),
    reportId: Number(r.report_id),
    createdAt: String(r.created_at),
    kind: String(r.kind),
    status: (r.status as ReportStatus) ?? null,
    message: (r.message as string) ?? null,
    isPublic: Boolean(r.is_public),
    actorType: r.actor_type as ReportEvent["actorType"],
    actorName: (r.actor_name as string) ?? null,
    data: parseJson<Record<string, unknown> | null>(r.data, null),
  };
}

export function geoContextFor(lat: number, lon: number, extra: Partial<GeoContext> = {}): GeoContext {
  return { ward: wardFor({ lat, lon }), majorRoad: nearestMajorRoad({ lat, lon }), ...extra };
}

export function emailHash(email: string): string {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getReport(id: number): Report | null {
  const row = db().prepare("SELECT * FROM reports WHERE id = ?").get(id) as Row | undefined;
  return row ? toReport(row) : null;
}

export function getReportByRef(ref: string): Report | null {
  const row = db().prepare("SELECT * FROM reports WHERE ref = ? COLLATE NOCASE").get(ref.trim()) as Row | undefined;
  return row ? toReport(row) : null;
}

export function getReportsByIds(ids: number[]): Report[] {
  if (!ids.length) return [];
  const rows = db()
    .prepare(`SELECT * FROM reports WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as Row[];
  const byId = new Map(rows.map((r) => [Number(r.id), toReport(r)]));
  return ids.map((id) => byId.get(id)).filter((r): r is Report => Boolean(r));
}

export function getPhotos(reportId: number): ReportPhoto[] {
  return (db().prepare("SELECT * FROM report_photos WHERE report_id = ? ORDER BY id").all(reportId) as Row[]).map(toPhoto);
}

export function getPhoto(photoId: number): ReportPhoto | null {
  const row = db().prepare("SELECT * FROM report_photos WHERE id = ?").get(photoId) as Row | undefined;
  return row ? toPhoto(row) : null;
}

export function getEvents(reportId: number, opts: { publicOnly?: boolean } = {}): ReportEvent[] {
  const sql = `SELECT * FROM report_events WHERE report_id = ? ${opts.publicOnly ? "AND is_public = 1" : ""} ORDER BY created_at, id`;
  return (db().prepare(sql).all(reportId) as Row[]).map(toEvent);
}

export type LinkedReport = { report: Report; kind: string; score: number | null; distanceMetres: number | null };

export function getLinkedReports(reportId: number): { suggested: LinkedReport[]; merged: LinkedReport[]; mergedInto: Report | null } {
  const rows = db()
    .prepare(
      `SELECT l.kind, l.score, l.distance_m, r.* FROM report_links l JOIN reports r ON r.id = l.related_id
       WHERE l.report_id = ? ORDER BY l.score DESC LIMIT 20`,
    )
    .all(reportId) as Row[];
  const suggested: LinkedReport[] = [];
  for (const row of rows) {
    const item = { report: toReport(row), kind: String(row.kind), score: row.score as number, distanceMetres: row.distance_m as number };
    if (item.kind === "suggested_duplicate" && item.report.status !== "duplicate") suggested.push(item);
  }
  const merged = (db().prepare("SELECT * FROM reports WHERE duplicate_of = ? ORDER BY created_at").all(reportId) as Row[]).map((r) => ({
    report: toReport(r),
    kind: "merged",
    score: null,
    distanceMetres: null,
  }));
  const self = getReport(reportId);
  const mergedInto = self?.duplicateOf ? getReport(self.duplicateOf) : null;
  return { suggested, merged, mergedInto };
}

/** Follow merge links to the report that is now tracking the problem. */
export function canonicalReport(report: Report): Report {
  let current = report;
  for (let i = 0; i < 5 && current.duplicateOf; i++) {
    const next = getReport(current.duplicateOf);
    if (!next) break;
    current = next;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

export function triageInputFor(report: Report): TriageInput {
  return {
    id: report.id,
    title: report.title,
    detail: report.detail,
    residentCategory: report.residentCategory,
    serviceName: report.serviceName,
    customType: report.customType,
    answers: report.answers,
    hazardLevel: report.hazardLevel,
    lat: report.lat,
    lon: report.lon,
    locationPrecision: report.locationPrecision,
    hasPhoto: report.hasPhoto,
    createdAt: report.createdAt,
    status: report.status,
    supporters: report.supporters,
    geoContext: report.geoContext,
  };
}

/** Open reports within the duplicate radius, scored against the subject. */
export function findDuplicateCandidates(
  subject: { id: number; lat: number; lon: number; category: string; title: string; detail: string; createdAt: string },
  opts: { limit?: number; radiusMetres?: number } = {},
): DuplicateCandidate[] {
  const radius = opts.radiusMetres ?? DUPLICATE_RADIUS_M;
  const { dLat, dLon } = degreeRadius(radius, subject.lat);
  const rows = db()
    .prepare(
      `SELECT id, lat, lon, category, title, detail, created_at FROM reports
       WHERE is_open = 1 AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND id != ?
       LIMIT 500`,
    )
    .all(subject.lat - dLat, subject.lat + dLat, subject.lon - dLon, subject.lon + dLon, subject.id) as Row[];
  return rows
    .map((r) => {
      const { score, distanceMetres } = duplicateScore(subject, {
        id: Number(r.id),
        lat: Number(r.lat),
        lon: Number(r.lon),
        category: String(r.category),
        title: String(r.title),
        detail: String(r.detail),
        createdAt: String(r.created_at),
      });
      return { id: Number(r.id), score, distanceMetres };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 10);
}

/**
 * Aggregate statistics over a merged incident: this report plus every report merged into it.
 * Merged reports stay in the database individually; only the canonical one is ranked.
 */
export function clusterStats(report: Report, text: TextAnalysis | null, images: ImageAnalysis[], now = new Date()): ClusterStats | null {
  const members = (db().prepare("SELECT * FROM reports WHERE duplicate_of = ?").all(report.id) as Row[]).map(toReport);
  if (!members.length) return null;
  const all = [{ report, text, images }, ...members.map((m) => ({ report: m, text: m.triage?.text ?? null, images: m.triage?.images ?? [] }))];
  const sev = (t: TextAnalysis | null) => (t ? (typeof t.urgency === "number" ? (t.urgency - 1) / 4 : t.severity) : 0);
  const imageSev = all.flatMap((m) => m.images.filter((i) => i.severity !== null && (i.uncertainty ?? 0) <= 0.7).map((i) => i.severity as number));
  // Injuries per week over the incident's active window (at least one week, at most the last 8 weeks).
  const windowStart = now.getTime() - 56 * 86_400_000;
  const recent = all.filter((m) => new Date(m.report.createdAt).getTime() >= windowStart);
  const injuries = recent.filter((m) => m.text?.injury).length;
  const first = Math.min(...recent.map((m) => new Date(m.report.createdAt).getTime()), now.getTime());
  const weeks = Math.max(1, (now.getTime() - first) / (7 * 86_400_000));
  return {
    // Merging adds each duplicate (and its supporters) to the canonical report's supporter count.
    reports: Math.max(all.length, 1 + report.supporters),
    injuries: all.filter((m) => m.text?.injury).length,
    injuriesPerWeek: Math.round((injuries / weeks) * 100) / 100,
    vulnerable: all.filter((m) => m.text?.vulnerable).length,
    maxTextSeverity: Math.max(...all.map((m) => sev(m.text))),
    maxImageSeverity: imageSev.length ? Math.max(...imageSev) : null,
  };
}

/**
 * Recompute and store triage for a report. Keeps the most recent LLM text
 * analysis and image analyses; recomputes baseline analysis, duplicates,
 * policy rules and priority every time.
 */
export function retriage(reportId: number, opts: { text?: TextAnalysis | null; now?: Date } = {}): Report | null {
  const report = getReport(reportId);
  if (!report) return null;
  const input = triageInputFor(report);

  const previousText = report.triage?.text;
  const text = opts.text ?? (previousText?.source === "llm" ? previousText : analyseText(input));
  const images = getPhotos(reportId)
    .map((p) => p.analysis)
    .filter((a): a is ImageAnalysis => Boolean(a));
  const cluster = clusterStats(report, text, images);
  if (cluster) input.cluster = cluster;

  const provisionalCategory = report.officerCategory ?? (text.category === "tbc" ? report.residentCategory : text.category);
  const dismissed = new Set(
    (db().prepare("SELECT related_id FROM report_links WHERE report_id = ? AND kind = 'not_duplicate'").all(reportId) as Row[]).map((r) =>
      Number(r.related_id),
    ),
  );
  // Only open reports need duplicate suggestions; closed ones are history.
  let duplicates = STATUS_BY_ID[report.status].open
    ? findDuplicateCandidates({ ...input, category: provisionalCategory }).filter((d) => !dismissed.has(d.id))
    : [];
  if (text.duplicateOf?.length) {
    const known = new Set(duplicates.map((d) => d.id));
    for (const id of text.duplicateOf) if (!known.has(id)) duplicates.push({ id, score: 0.9, distanceMetres: -1 });
    duplicates = duplicates.map((d) => (text.duplicateOf!.includes(d.id) ? { ...d, score: Math.max(d.score, 0.9) } : d));
  }

  const officerFlags: Flag[] = [];
  if (report.moderation === "dubious") {
    officerFlags.push({ code: "officer_flagged", label: "Marked dubious by an officer", severity: "warning", source: "officer", dubious: true });
  }
  const record = buildTriageRecord({
    input,
    text: report.moderation === "genuine" ? { ...text, flags: text.flags.filter((f) => !f.dubious) } : text,
    images,
    duplicates,
    overrides: { category: report.officerCategory, priorityScore: report.priorityOverride, flags: officerFlags },
    now: opts.now,
  });
  if (report.moderation === "genuine") {
    record.flags = record.flags.filter((f) => !f.dubious);
    record.dubious = false;
    record.reviewReasons = record.reviewReasons.filter((r) => r !== "Possibly dubious report");
    record.needsReview = record.reviewReasons.length > 0;
  }

  const dueAt =
    record.priority.targetHours === null ? null : new Date(new Date(report.createdAt).getTime() + record.priority.targetHours * 3_600_000).toISOString();
  const triageSource = report.officerCategory || report.priorityOverride !== null ? "officer" : text.source;

  const database = db();
  database
    .prepare(
      `UPDATE reports SET category = ?, category_source = ?, category_confidence = ?, suggested_category = ?,
        priority_score = ?, priority_band = ?, response_target = ?, due_at = ?, needs_review = ?, dubious = ?,
        flags = ?, triage = ?, triage_source = ? WHERE id = ?`,
    )
    .run(
      record.category.category,
      record.category.source,
      record.category.confidence,
      record.category.suggested,
      record.priority.score,
      record.priority.band,
      record.priority.responseTarget,
      dueAt,
      record.needsReview ? 1 : 0,
      record.dubious ? 1 : 0,
      JSON.stringify(record.flags),
      JSON.stringify(record),
      triageSource,
      reportId,
    );

  database.prepare("DELETE FROM report_links WHERE report_id = ? AND kind = 'suggested_duplicate'").run(reportId);
  const insertLink = database.prepare(
    "INSERT OR REPLACE INTO report_links (report_id, related_id, kind, score, distance_m, created_at) VALUES (?, ?, 'suggested_duplicate', ?, ?, ?)",
  );
  for (const d of record.duplicates.filter((d) => d.score >= DUPLICATE_THRESHOLD)) {
    if (getReport(d.id)) insertLink.run(reportId, d.id, d.score, d.distanceMetres, nowIso());
  }
  return getReport(reportId);
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export type NewReportInput = {
  category: CategoryId;
  serviceName: string;
  customType?: string | null;
  title: string;
  detail: string;
  answers: Answers;
  hazardLevel: HazardLevel | null;
  lat: number;
  lon: number;
  locationText?: string | null;
  locationPrecision: "exact" | "approximate";
  locationSource?: "map" | "photo";
  contact: { firstName: string; lastName: string; email: string; phone?: string | null };
  photos: { fileName: string; mime: string; bytes: number; sha256: string }[];
  createdAt?: string;
};

export function upsertResident(contact: NewReportInput["contact"]): number {
  const email = contact.email.trim().toLowerCase();
  const database = db();
  const existing = database.prepare("SELECT id FROM residents WHERE email = ?").get(email) as Row | undefined;
  if (existing) {
    database
      .prepare(
        "UPDATE residents SET first_name = COALESCE(NULLIF(?, ''), first_name), last_name = COALESCE(NULLIF(?, ''), last_name), phone = COALESCE(?, phone) WHERE id = ?",
      )
      .run(contact.firstName, contact.lastName, contact.phone || null, Number(existing.id));
    return Number(existing.id);
  }
  const res = database
    .prepare("INSERT INTO residents (email, first_name, last_name, phone, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(email, contact.firstName, contact.lastName, contact.phone || null, nowIso());
  return Number(res.lastInsertRowid);
}

export function residentRef(id: number): string {
  return `SR${String(id - RESIDENT_ID_OFFSET).padStart(6, "0")}`;
}

export function addEvent(
  reportId: number,
  e: { kind: string; status?: ReportStatus | null; message?: string | null; isPublic?: boolean; actor: Actor; data?: unknown; createdAt?: string },
) {
  db()
    .prepare(
      `INSERT INTO report_events (report_id, created_at, kind, status, message, is_public, actor_type, actor_name, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      reportId,
      e.createdAt ?? nowIso(),
      e.kind,
      e.status ?? null,
      e.message ?? null,
      e.isPublic ? 1 : 0,
      e.actor.type,
      e.actor.name ?? null,
      e.data === undefined ? null : JSON.stringify(e.data),
    );
}

export function createResidentReport(input: NewReportInput): Report {
  return transaction(() => {
    const database = db();
    const residentId = upsertResident(input.contact);
    const maxRow = database.prepare("SELECT MAX(id) AS m FROM reports WHERE id > ?").get(RESIDENT_ID_OFFSET) as Row;
    const id = Math.max(Number(maxRow.m ?? 0), RESIDENT_ID_OFFSET) + 1;
    const createdAt = input.createdAt ?? nowIso();
    const geo = geoContextFor(input.lat, input.lon);
    const cls = input.category === "pothole" ? potholeClass(input.answers) : null;

    database
      .prepare(
        `INSERT INTO reports (id, ref, source, status, created_at, updated_at, title, detail, location_text, lat, lon,
          location_precision, location_source, ward, resident_category, service_name, custom_type, answers, hazard_level, pothole_class,
          has_photo, in_sample, resident_id, category, category_source, llm_status, vision_status, geo_context)
         VALUES (?, ?, 'resident', 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'resident', 'queued', ?, ?)`,
      )
      .run(
        id,
        residentRef(id),
        createdAt,
        createdAt,
        input.title,
        input.detail,
        input.locationText ?? null,
        input.lat,
        input.lon,
        input.locationPrecision,
        input.locationSource ?? "map",
        geo.ward ?? null,
        input.category,
        input.serviceName,
        input.customType ?? null,
        JSON.stringify(input.answers),
        input.hazardLevel,
        cls,
        input.photos.length ? 1 : 0,
        residentId,
        input.category,
        input.photos.length ? "queued" : "none",
        JSON.stringify(geo),
      );

    const insertPhoto = database.prepare(
      "INSERT INTO report_photos (report_id, file_name, mime, bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const p of input.photos) insertPhoto.run(id, p.fileName, p.mime, p.bytes, p.sha256, createdAt);

    addEvent(id, {
      kind: "created",
      status: "received",
      message: STATUS_BY_ID.received.publicMessage,
      isPublic: true,
      actor: { type: "resident", name: `${input.contact.firstName} ${input.contact.lastName}`.trim() },
      createdAt,
    });

    const triaged = retriage(id)!;
    addEvent(id, {
      kind: "triage",
      message: `Automatically assessed: ${triaged.priorityBand} priority (${triaged.priorityScore}/100), category ${triaged.category}.`,
      actor: { type: "ai", name: triaged.triage?.text?.model ?? "baseline" },
      data: { band: triaged.priorityBand, score: triaged.priorityScore, flags: triaged.flags.map((f) => f.code) },
    });

    // Council policy: potholes below the intervention level are monitored rather than repaired.
    if (cls === "MONITOR" && triaged.category === "pothole") {
      setStatusInternal(triaged, "monitoring", {
        message:
          "Thank you. Potholes less than 2cm deep on a pavement or 4cm in a road are below the council's intervention level, so this will be monitored and not automatically repaired.",
        actor: { type: "ai", name: "Council policy rule" },
        isPublic: true,
      });
    }
    return getReport(id)!;
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type ReportFilters = {
  q?: string;
  category?: string;
  service?: string;
  ward?: string;
  status?: string; // "open" | "closed" | "all" | a ReportStatus
  band?: string;
  queue?: "review" | "dubious" | "duplicates" | "unscheduled" | "";
  hasPhoto?: boolean;
  source?: string;
  residentId?: number;
  /** Public listings hide reports flagged as dubious and merged duplicates. */
  publicOnly?: boolean;
  near?: { lat: number; lon: number; radiusMetres: number };
  sort?: "priority" | "newest" | "oldest" | "due";
  page?: number;
  pageSize?: number;
};

export type SearchResult = { items: Report[]; total: number; page: number; pageSize: number; pages: number };

/** Turn free text into a safe FTS5 query (prefix match on each word). */
export function ftsQuery(q: string): string | null {
  const words = q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 8);
  return words.length ? words.map((w) => `"${w}"*`).join(" ") : null;
}

function buildWhere(f: ReportFilters): { where: string; params: SQLInputValue[] } {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];

  const status = f.status ?? "open";
  if (status === "open") {
    clauses.push("is_open = 1");
  } else if (status === "closed") {
    clauses.push("is_open = 0");
  } else if (status !== "all") {
    clauses.push("status = ?");
    params.push(status);
  }
  if (f.category) {
    clauses.push("category = ?");
    params.push(f.category);
  }
  if (f.service) {
    clauses.push("service_name = ?");
    params.push(f.service);
  }
  if (f.ward) {
    clauses.push("ward = ?");
    params.push(f.ward);
  }
  if (f.band) {
    clauses.push("priority_band = ?");
    params.push(f.band);
  }
  if (f.source) {
    clauses.push("source = ?");
    params.push(f.source);
  }
  if (f.hasPhoto) clauses.push("has_photo = 1");
  if (f.publicOnly) clauses.push("dubious = 0 AND status != 'duplicate'");
  if (f.residentId !== undefined) {
    clauses.push("resident_id = ?");
    params.push(f.residentId);
  }
  switch (f.queue) {
    case "review":
      clauses.push("needs_review = 1");
      break;
    case "dubious":
      clauses.push("dubious = 1");
      break;
    case "duplicates":
      clauses.push("EXISTS (SELECT 1 FROM report_links l WHERE l.report_id = reports.id AND l.kind = 'suggested_duplicate')");
      break;
    case "unscheduled":
      clauses.push("work_order_id IS NULL AND status IN ('received', 'in_progress')");
      break;
  }
  if (f.near) {
    const { dLat, dLon } = degreeRadius(f.near.radiusMetres, f.near.lat);
    clauses.push("lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?");
    params.push(f.near.lat - dLat, f.near.lat + dLat, f.near.lon - dLon, f.near.lon + dLon);
  }
  if (f.q?.trim()) {
    const q = f.q.trim();
    const refMatch = /^(sr|fms)?\s*(\d{3,})$/i.exec(q.replace(/[-\s]/g, ""));
    if (refMatch) {
      clauses.push("(ref = ? COLLATE NOCASE OR id = ? OR ref LIKE ?)");
      params.push(q.replace(/[-\s]/g, "").toUpperCase(), Number(refMatch[2]), `%${refMatch[2]}`);
    } else {
      const fts = ftsQuery(q);
      if (fts) {
        clauses.push("id IN (SELECT rowid FROM reports_fts WHERE reports_fts MATCH ?)");
        params.push(fts);
      }
    }
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

const SORTS: Record<NonNullable<ReportFilters["sort"]>, string> = {
  priority: "priority_score DESC, created_at ASC",
  newest: "created_at DESC",
  oldest: "created_at ASC",
  due: "due_at IS NULL, due_at ASC, priority_score DESC",
};

export function searchReports(f: ReportFilters): SearchResult {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 200);
  const page = Math.max(f.page ?? 1, 1);
  const { where, params } = buildWhere(f);
  const database = db();
  const total = Number((database.prepare(`SELECT COUNT(*) AS n FROM reports ${where}`).get(...params) as Row).n);
  // Two phases: rank ids using covering indexes, then load only this page's full rows.
  const ids = (
    database.prepare(`SELECT id FROM reports ${where} ORDER BY ${SORTS[f.sort ?? "priority"]} LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Row[]
  ).map((r) => Number(r.id));
  return { items: getReportsByIds(ids), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Lightweight rows for map pins: every matching report, without pagination. */
export function mapPins(f: ReportFilters, limit = 5000) {
  const { where, params } = buildWhere(f);
  return (
    db()
      .prepare(
        `SELECT id, ref, lat, lon, category, priority_band, priority_score, status, title, has_photo FROM reports ${where}
         ORDER BY priority_score DESC LIMIT ?`,
      )
      .all(...params, limit) as Row[]
  ).map((r) => ({
    id: Number(r.id),
    ref: String(r.ref),
    lat: Number(r.lat),
    lon: Number(r.lon),
    category: String(r.category) as EffectiveCategoryId,
    priorityBand: String(r.priority_band) as PriorityBand,
    priorityScore: Number(r.priority_score),
    status: String(r.status) as ReportStatus,
    title: String(r.title),
    hasPhoto: Boolean(r.has_photo),
  }));
}

/** Open reports near a point, for the resident "has this already been reported?" check. */
export function nearbyOpenReports(lat: number, lon: number, opts: { radiusMetres?: number; category?: string; limit?: number } = {}) {
  const radius = opts.radiusMetres ?? 150;
  const { items } = searchReports({
    status: "open",
    near: { lat, lon, radiusMetres: radius },
    category: opts.category,
    pageSize: 200,
    sort: "newest",
  });
  return items
    .map((r) => ({ report: r, distanceMetres: Math.round(Math.hypot((r.lat - lat) * 110_540, (r.lon - lon) * 111_320 * Math.cos((lat * Math.PI) / 180))) }))
    .filter((x) => x.distanceMetres <= radius && x.report.status !== "duplicate")
    .sort((a, b) => a.distanceMetres - b.distanceMetres)
    .slice(0, opts.limit ?? 10);
}

export type DashboardStats = ReturnType<typeof dashboardStats>;

/** Queue counts for the console, from one index-only pass over open reports. */
export function dashboardStats() {
  const database = db();
  const now = nowIso();
  const groups = database
    .prepare(
      `SELECT priority_band AS band, category, COUNT(*) AS n, SUM(needs_review) AS review, SUM(dubious) AS dubious,
         SUM(due_at IS NOT NULL AND due_at < ?) AS overdue, SUM(source = 'resident' AND due_at IS NOT NULL AND due_at < ?) AS overdue_resident
       FROM reports WHERE is_open = 1 GROUP BY priority_band, category`,
    )
    .all(now, now) as Row[];
  const byBand: Partial<Record<PriorityBand, number>> = {};
  const categoryCounts = new Map<EffectiveCategoryId, number>();
  let open = 0;
  let needsReview = 0;
  let dubious = 0;
  let overdue = 0;
  let overdueResident = 0;
  for (const g of groups) {
    const n = Number(g.n);
    open += n;
    needsReview += Number(g.review);
    dubious += Number(g.dubious);
    overdue += Number(g.overdue);
    overdueResident += Number(g.overdue_resident);
    const band = String(g.band) as PriorityBand;
    byBand[band] = (byBand[band] ?? 0) + n;
    const cat = String(g.category) as EffectiveCategoryId;
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + n);
  }
  const one = (sql: string, ...p: SQLInputValue[]) => Number((database.prepare(sql).get(...p) as Row).n);
  const byStatus = database.prepare("SELECT status AS k, COUNT(*) AS n FROM reports GROUP BY status").all() as Row[];
  return {
    open,
    needsReview,
    dubious,
    overdue,
    overdueResident,
    duplicates: one(
      `SELECT COUNT(DISTINCT report_id) AS n FROM report_links l JOIN reports r ON r.id = l.report_id
       WHERE l.kind = 'suggested_duplicate' AND r.is_open = 1`,
    ),
    last7Days: one("SELECT COUNT(*) AS n FROM reports WHERE created_at >= ?", new Date(Date.now() - 7 * 86_400_000).toISOString()),
    // Only open reports need the models; closed history is never re-triaged.
    llmQueued: one("SELECT COUNT(*) AS n FROM reports WHERE is_open = 1 AND duplicate_of IS NULL AND llm_status IN ('queued', 'failed')"),
    visionQueued: one("SELECT COUNT(*) AS n FROM reports WHERE (is_open = 1 OR status = 'duplicate') AND vision_status IN ('queued', 'failed')"),
    byBand,
    byCategory: [...categoryCounts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    byStatus: Object.fromEntries(byStatus.map((r) => [String(r.k), Number(r.n)])) as Partial<Record<ReportStatus, number>>,
  };
}

// ---------------------------------------------------------------------------
// Officer actions (human in the loop)
// ---------------------------------------------------------------------------

function setStatusInternal(report: Report, status: ReportStatus, e: { message?: string | null; actor: Actor; isPublic?: boolean; at?: string }) {
  const now = e.at ?? nowIso();
  db().prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ?").run(status, now, report.id);
  addEvent(report.id, {
    kind: "status",
    status,
    message: e.message || STATUS_BY_ID[status].publicMessage,
    isPublic: e.isPublic ?? true,
    actor: e.actor,
    data: { from: report.status, to: status },
    createdAt: now,
  });
}

export function updateStatus(reportId: number, status: ReportStatus, opts: { message?: string | null; actor: Actor; isPublic?: boolean; at?: string }) {
  return transaction(() => {
    const report = getReport(reportId);
    if (!report) throw new Error("Report not found");
    if (report.status === status && !opts.message) return report;
    setStatusInternal(report, status, opts);
    // Keep merged duplicates in step so their reporters see progress.
    for (const child of db().prepare("SELECT id FROM reports WHERE duplicate_of = ?").all(reportId) as Row[]) {
      addEvent(Number(child.id), {
        kind: "status",
        status,
        message: `Update on the original report ${report.ref}: ${opts.message || STATUS_BY_ID[status].publicMessage}`,
        isPublic: opts.isPublic ?? true,
        actor: opts.actor,
      });
    }
    return getReport(reportId)!;
  });
}

function recordFeedback(report: Report, field: string, modelValue: unknown, officerValue: unknown, officerId?: number | null) {
  db()
    .prepare(
      `INSERT INTO triage_feedback (report_id, created_at, officer_id, field, model_value, officer_value, model_source, snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      report.id,
      nowIso(),
      officerId ?? null,
      field,
      modelValue === null || modelValue === undefined ? null : String(modelValue),
      officerValue === null || officerValue === undefined ? null : String(officerValue),
      report.triage?.text?.source ?? report.triageSource,
      JSON.stringify(toFixMyStreetRecord(report)),
    );
}

export function overrideCategory(reportId: number, category: EffectiveCategoryId | null, actor: Actor) {
  return transaction(() => {
    const report = getReport(reportId);
    if (!report) throw new Error("Report not found");
    db().prepare("UPDATE reports SET officer_category = ?, updated_at = ? WHERE id = ?").run(category, nowIso(), reportId);
    recordFeedback(report, "category", report.category, category ?? "(cleared)", actor.officerId);
    addEvent(reportId, {
      kind: "override",
      message: category ? `Category set to ${category} (was ${report.category}).` : "Category override removed.",
      actor,
      data: { field: "category", from: report.category, to: category },
    });
    return retriage(reportId)!;
  });
}

export function overridePriority(reportId: number, score: number | null, actor: Actor, reason?: string | null) {
  return transaction(() => {
    const report = getReport(reportId);
    if (!report) throw new Error("Report not found");
    const value = score === null ? null : Math.max(0, Math.min(100, Math.round(score)));
    db().prepare("UPDATE reports SET priority_override = ?, updated_at = ? WHERE id = ?").run(value, nowIso(), reportId);
    recordFeedback(report, "priority", report.priorityScore, value ?? "(cleared)", actor.officerId);
    addEvent(reportId, {
      kind: "override",
      message: value === null ? "Priority override removed." : `Priority set to ${value} (was ${report.priorityScore}).${reason ? ` Reason: ${reason}` : ""}`,
      actor,
      data: { field: "priority", from: report.priorityScore, to: value, reason },
    });
    return retriage(reportId)!;
  });
}

export function setModeration(reportId: number, moderation: "dubious" | "genuine" | null, actor: Actor) {
  return transaction(() => {
    const report = getReport(reportId);
    if (!report) throw new Error("Report not found");
    db().prepare("UPDATE reports SET moderation = ?, updated_at = ? WHERE id = ?").run(moderation, nowIso(), reportId);
    recordFeedback(report, "dubious", report.dubious ? "dubious" : "genuine", moderation ?? "(cleared)", actor.officerId);
    addEvent(reportId, {
      kind: "moderation",
      message: moderation === "dubious" ? "Marked as dubious." : moderation === "genuine" ? "Confirmed as a genuine report." : "Moderation decision cleared.",
      actor,
    });
    return retriage(reportId)!;
  });
}

export function addNote(reportId: number, message: string, actor: Actor, isPublic: boolean) {
  addEvent(reportId, { kind: "note", message, isPublic, actor });
  db().prepare("UPDATE reports SET updated_at = ? WHERE id = ?").run(nowIso(), reportId);
}

export function dismissDuplicate(reportId: number, relatedId: number, actor: Actor) {
  return transaction(() => {
    const report = getReport(reportId);
    if (!report) throw new Error("Report not found");
    db()
      .prepare("INSERT OR REPLACE INTO report_links (report_id, related_id, kind, created_at) VALUES (?, ?, 'not_duplicate', ?)")
      .run(reportId, relatedId, nowIso());
    db().prepare("DELETE FROM report_links WHERE report_id = ? AND related_id = ? AND kind = 'suggested_duplicate'").run(reportId, relatedId);
    recordFeedback(report, "duplicate", relatedId, "not_duplicate", actor.officerId);
    addEvent(reportId, { kind: "duplicate", message: `Not a duplicate of ${getReport(relatedId)?.ref ?? relatedId}.`, actor });
  });
}

/** Merge `duplicateId` into `canonicalId`. The duplicate's reporter follows the canonical report from now on. */
export function mergeReports(duplicateId: number, canonicalId: number, actor: Actor) {
  if (duplicateId === canonicalId) throw new Error("Cannot merge a report into itself");
  return transaction(() => {
    const dup = getReport(duplicateId);
    const target = getReport(canonicalId);
    if (!dup || !target) throw new Error("Report not found");
    if (target.duplicateOf) throw new Error(`${target.ref} is itself merged into another report`);
    const database = db();
    const now = nowIso();
    database
      .prepare("UPDATE reports SET status = 'duplicate', duplicate_of = ?, updated_at = ? WHERE id = ?")
      .run(canonicalId, now, duplicateId);
    // Re-point anything already merged into the duplicate.
    database.prepare("UPDATE reports SET duplicate_of = ? WHERE duplicate_of = ?").run(canonicalId, duplicateId);
    const supporters = 1 + dup.supporters;
    database.prepare("UPDATE reports SET supporters = supporters + ?, updated_at = ? WHERE id = ?").run(supporters, now, canonicalId);
    if (dup.hasPhoto && !target.hasPhoto) database.prepare("UPDATE reports SET has_photo = 1 WHERE id = ?").run(canonicalId);
    database
      .prepare("INSERT OR REPLACE INTO report_links (report_id, related_id, kind, created_at) VALUES (?, ?, 'merged', ?)")
      .run(duplicateId, canonicalId, now);
    database.prepare("DELETE FROM report_links WHERE (report_id = ? OR related_id = ?) AND kind = 'suggested_duplicate'").run(duplicateId, duplicateId);
    // Only human decisions are training feedback; the AI's own merges are not corrections.
    if (actor.type === "officer") recordFeedback(dup, "duplicate", null, target.ref, actor.officerId);
    addEvent(duplicateId, {
      kind: "status",
      status: "duplicate",
      message: `${STATUS_BY_ID.duplicate.publicMessage} You can follow progress on ${target.ref}.`,
      isPublic: true,
      actor,
      data: { mergedInto: canonicalId },
    });
    addEvent(canonicalId, {
      kind: "merge",
      message: `${dup.ref} merged into this report (now ${target.supporters + supporters + 1} reports of this problem).`,
      isPublic: true,
      actor,
      data: { merged: duplicateId },
    });
    retriage(canonicalId);
    return getReport(canonicalId)!;
  });
}

/** Undo a merge (for example a wrong AI merge): the report becomes its own incident again. */
export function unmergeReport(duplicateId: number, actor: Actor) {
  return transaction(() => {
    const dup = getReport(duplicateId);
    if (!dup?.duplicateOf) throw new Error("This report is not merged");
    const canonicalId = dup.duplicateOf;
    const now = nowIso();
    const database = db();
    database.prepare("UPDATE reports SET status = 'received', duplicate_of = NULL, updated_at = ? WHERE id = ?").run(now, duplicateId);
    database
      .prepare("UPDATE reports SET supporters = MAX(0, supporters - ?), updated_at = ? WHERE id = ?")
      .run(1 + dup.supporters, now, canonicalId);
    database.prepare("DELETE FROM report_links WHERE report_id = ? AND related_id = ? AND kind = 'merged'").run(duplicateId, canonicalId);
    // Remember the decision so neither the suggestions nor the AI merge them again.
    for (const [a, b] of [
      [duplicateId, canonicalId],
      [canonicalId, duplicateId],
    ]) {
      database
        .prepare("INSERT OR REPLACE INTO report_links (report_id, related_id, kind, created_at) VALUES (?, ?, 'not_duplicate', ?)")
        .run(a, b, now);
    }
    recordFeedback(dup, "duplicate", getReport(canonicalId)?.ref ?? canonicalId, "not_duplicate", actor.officerId);
    addEvent(duplicateId, {
      kind: "status",
      status: "received",
      message: "This report has been separated from the one it was merged with and will be dealt with on its own.",
      isPublic: true,
      actor,
    });
    addEvent(canonicalId, { kind: "merge", message: `${dup.ref} was separated from this report by an officer.`, actor });
    retriage(duplicateId);
    retriage(canonicalId);
    return getReport(duplicateId)!;
  });
}

/** "Me too" from a resident who found an existing report instead of submitting a new one. */
export function addSupporter(reportId: number, email: string, residentId: number | null, note?: string | null): { added: boolean; report: Report } {
  return transaction(() => {
    const report = getReport(reportId);
    if (!report) throw new Error("Report not found");
    const target = canonicalReport(report);
    const res = db()
      .prepare("INSERT OR IGNORE INTO report_supporters (report_id, email_hash, resident_id, created_at) VALUES (?, ?, ?, ?)")
      .run(target.id, emailHash(email), residentId, nowIso());
    const added = Number(res.changes) > 0;
    if (added) {
      db().prepare("UPDATE reports SET supporters = supporters + 1 WHERE id = ?").run(target.id);
      addEvent(target.id, {
        kind: "support",
        message: "Another resident confirmed this is the same problem and added their support.",
        isPublic: true,
        actor: { type: "resident" },
        data: { confirmedDuplicate: true, residentId },
      });
      retriage(target.id);
    }
    // Optional extra details from the resident who confirmed the duplicate (officers only).
    const extra = note?.trim().slice(0, 2000);
    if (extra) {
      addEvent(target.id, { kind: "support_note", message: `Extra details from a resident who confirmed this problem: ${extra}`, actor: { type: "resident" }, data: { residentId } });
    }
    return { added, report: getReport(target.id)! };
  });
}

// ---------------------------------------------------------------------------
// External AI results
// ---------------------------------------------------------------------------

export function applyTextAnalysis(reportId: number, analysis: TextAnalysis): Report | null {
  return transaction(() => {
    const report = getReport(reportId);
    if (!report) return null;
    db().prepare("UPDATE reports SET llm_status = 'done' WHERE id = ?").run(reportId);
    const updated = retriage(reportId, { text: analysis })!;
    addEvent(reportId, {
      kind: "triage",
      message: `LLM assessment${analysis.model ? ` (${analysis.model})` : ""}: ${updated.priorityBand} priority (${updated.priorityScore}/100), category ${updated.category}.`,
      actor: { type: "ai", name: analysis.model ?? "llm" },
      data: { summary: analysis.summary, keyFeatures: analysis.keyFeatures },
    });
    return updated;
  });
}

export function applyImageAnalysis(photoId: number, analysis: ImageAnalysis): Report | null {
  return transaction(() => {
    const photo = getPhoto(photoId);
    if (!photo) return null;
    db().prepare("UPDATE report_photos SET analysis = ? WHERE id = ?").run(JSON.stringify({ ...analysis, photoId }), photoId);
    const pending = Number(
      (db().prepare("SELECT COUNT(*) AS n FROM report_photos WHERE report_id = ? AND analysis IS NULL").get(photo.reportId) as Row).n,
    );
    db().prepare("UPDATE reports SET vision_status = ? WHERE id = ?").run(pending ? "queued" : "done", photo.reportId);
    const updated = retriage(photo.reportId)!;
    addEvent(photo.reportId, {
      kind: "triage",
      message: `Image assessment${analysis.model ? ` (${analysis.model})` : ""}: ${analysis.category ?? "no issue detected"} (confidence ${Math.round(analysis.categoryConfidence * 100)}%).`,
      actor: { type: "ai", name: analysis.model ?? "vision" },
    });
    return updated;
  });
}

export function setIntegrationStatus(reportIds: number[], field: "llm_status" | "vision_status", value: string) {
  if (!reportIds.length) return;
  db()
    .prepare(`UPDATE reports SET ${field} = ? WHERE id IN (${reportIds.map(() => "?").join(",")})`)
    .run(value, ...reportIds);
}

export function integrationQueue(stage: "llm" | "vision", limit: number, after = 0) {
  const field = stage === "llm" ? "llm_status" : "vision_status";
  const rows = db()
    .prepare(`SELECT * FROM reports WHERE ${field} = 'queued' AND id > ? ORDER BY id LIMIT ?`)
    .all(after, limit) as Row[];
  return rows.map(toReport);
}

// ---------------------------------------------------------------------------
// FixMyStreet-shaped export (the schema the AI teams work from)
// ---------------------------------------------------------------------------

export function photoUrl(photoId: number) {
  return `/api/photos/${photoId}`;
}

export function toFixMyStreetRecord(report: Report, photos?: ReportPhoto[]) {
  const answers = report.residentCategory in CATEGORY_BY_ID ? describeAnswers(report.residentCategory, report.answers) : [];
  const list = photos ?? [];
  return {
    id: report.id,
    ref: report.ref,
    status: statusToFixMyStreet(report.status),
    service_name: report.serviceName,
    service_code: report.serviceName,
    category: report.residentCategory,
    title: report.title,
    detail: report.detail,
    description: `${report.title}: ${report.detail}`,
    lat: report.lat,
    lon: report.lon,
    has_photo: report.hasPhoto,
    in_sample: report.inSample,
    photo_path: list[0] ? photoUrl(list[0].id) : null,
    // Extensions beyond the scraped schema:
    requested_at: report.createdAt,
    source: report.source,
    ward: report.ward,
    location_text: report.locationText,
    custom_type: report.customType,
    hazard_level: report.hazardLevel,
    answers: report.answers,
    answers_text: answers,
    photos: list.map((p) => ({ id: p.id, url: photoUrl(p.id), mime: p.mime })),
    geo_context: report.geoContext,
    supporters: report.supporters,
  };
}

export function isOpen(report: Report) {
  return STATUS_BY_ID[report.status]?.open ?? false;
}

/** Headline figures for the resident homepage. */
export function publicStats() {
  const database = db();
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const one = (sql: string, ...p: SQLInputValue[]) => Number((database.prepare(sql).get(...p) as Row).n);
  return {
    open: one("SELECT COUNT(*) AS n FROM reports WHERE is_open = 1 AND dubious = 0"),
    fixedThisYear: one("SELECT COUNT(*) AS n FROM reports WHERE status = 'completed' AND updated_at >= ?", yearAgo),
    reportedThisMonth: one("SELECT COUNT(*) AS n FROM reports WHERE created_at >= ?", monthAgo),
  };
}

/** Position of a report within a filtered, sorted queue, with its neighbours (for "next in queue"). */
export function queueNeighbours(f: ReportFilters, reportId: number) {
  const { where, params } = buildWhere(f);
  const ids = (db().prepare(`SELECT id FROM reports ${where} ORDER BY ${SORTS[f.sort ?? "priority"]}`).all(...params) as Row[]).map((r) => Number(r.id));
  const index = ids.indexOf(reportId);
  return {
    position: index >= 0 ? index + 1 : null,
    total: ids.length,
    prevId: index > 0 ? ids[index - 1] : null,
    nextId: index >= 0 && index < ids.length - 1 ? ids[index + 1] : index < 0 ? (ids[0] ?? null) : null,
  };
}
