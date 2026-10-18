import { officerOrUnauthorized } from "@/lib/auth";
import {
  addNote,
  getEvents,
  getLinkedReports,
  getPhotos,
  getReport,
  mergeReports,
  unmergeReport,
  overrideCategory,
  overridePriority,
  photoUrl,
  retriage,
  setModeration,
  updateStatus,
  type Actor,
} from "@/lib/repo/reports";
import { isReportStatus } from "@/lib/statuses";
import { isEffectiveCategoryId } from "@/lib/taxonomy";
import { db } from "@/lib/db";

async function load(ctx: RouteContext<"/api/council/reports/[id]">) {
  const { id } = await ctx.params;
  return getReport(Number(id));
}

export async function GET(_request: Request, ctx: RouteContext<"/api/council/reports/[id]">) {
  const officer = await officerOrUnauthorized();
  if (officer instanceof Response) return officer;
  const report = await load(ctx);
  if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
  const contact = report.residentId ? db().prepare("SELECT email, first_name, last_name, phone FROM residents WHERE id = ?").get(report.residentId) : null;
  const links = getLinkedReports(report.id);
  return Response.json({
    report,
    contact,
    photos: getPhotos(report.id).map((p) => ({ ...p, url: photoUrl(p.id) })),
    events: getEvents(report.id),
    suggestedDuplicates: links.suggested.map((l) => ({ id: l.report.id, ref: l.report.ref, title: l.report.title, score: l.score, distanceMetres: l.distanceMetres })),
    merged: links.merged.map((l) => ({ id: l.report.id, ref: l.report.ref })),
  });
}

/**
 * Officer actions as JSON, for the map component and other clients. One action per request:
 *   { "status": "in_progress", "message": "...", "public": true }
 *   { "category": "pothole" | "tbc" | null }
 *   { "priorityScore": 80 | null, "reason": "..." }
 *   { "moderation": "dubious" | "genuine" | null }
 *   { "note": "...", "public": false }
 *   { "mergeInto": 12345 }
 *   { "retriage": true }
 *   { "unmerge": true }      (undo a merge: this report becomes its own incident again)
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/council/reports/[id]">) {
  const officer = await officerOrUnauthorized();
  if (officer instanceof Response) return officer;
  const report = await load(ctx);
  if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });
  const actor: Actor = { type: "officer", name: officer.name, officerId: officer.officerId };

  try {
    if ("status" in body) {
      if (!isReportStatus(body.status) || body.status === "duplicate") return Response.json({ error: "Invalid status" }, { status: 422 });
      return Response.json({ report: updateStatus(report.id, body.status, { message: typeof body.message === "string" ? body.message : null, actor, isPublic: body.public !== false }) });
    }
    if ("category" in body) {
      if (body.category !== null && !isEffectiveCategoryId(body.category)) return Response.json({ error: "Invalid category" }, { status: 422 });
      return Response.json({ report: overrideCategory(report.id, body.category as never, actor) });
    }
    if ("priorityScore" in body) {
      const score = body.priorityScore === null ? null : Number(body.priorityScore);
      if (score !== null && !Number.isFinite(score)) return Response.json({ error: "priorityScore must be a number 0-100 or null" }, { status: 422 });
      return Response.json({ report: overridePriority(report.id, score, actor, typeof body.reason === "string" ? body.reason : null) });
    }
    if ("moderation" in body) {
      if (body.moderation !== null && body.moderation !== "dubious" && body.moderation !== "genuine") return Response.json({ error: "Invalid moderation" }, { status: 422 });
      return Response.json({ report: setModeration(report.id, body.moderation as never, actor) });
    }
    if ("note" in body && typeof body.note === "string" && body.note.trim()) {
      addNote(report.id, body.note.trim().slice(0, 2000), actor, body.public === true);
      return Response.json({ report: getReport(report.id) });
    }
    if ("mergeInto" in body) {
      return Response.json({ report: mergeReports(report.id, Number(body.mergeInto), actor) });
    }
    if (body.unmerge === true) return Response.json({ report: unmergeReport(report.id, actor) });
    if (body.retriage === true) return Response.json({ report: retriage(report.id) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Update failed" }, { status: 409 });
  }
  return Response.json({ error: "No recognised action in body" }, { status: 400 });
}
