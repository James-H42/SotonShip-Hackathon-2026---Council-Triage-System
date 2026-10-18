import { db, parseJson } from "@/lib/db";
import { integrationAuth } from "@/lib/integrations/auth";

/**
 * Officer corrections for active learning: every time an officer overrides a
 * category, priority, duplicate decision or dubious flag, the model's value,
 * the officer's value and a snapshot of the report are recorded here.
 *   GET /api/integrations/feedback?since=2026-10-01T00:00:00Z&field=category
 */
export async function GET(request: Request) {
  const denied = await integrationAuth(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const since = params.get("since") ?? "1970-01-01";
  const field = params.get("field");
  const limit = Math.min(Number(params.get("limit") ?? 1000) || 1000, 10000);
  const rows = db()
    .prepare(
      `SELECT id, report_id, created_at, field, model_value, officer_value, model_source, snapshot FROM triage_feedback
       WHERE created_at > ? ${field ? "AND field = ?" : ""} ORDER BY created_at LIMIT ?`,
    )
    .all(...(field ? [since, field, limit] : [since, limit])) as Record<string, string | number>[];
  return Response.json({
    count: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      reportId: r.report_id,
      at: r.created_at,
      field: r.field,
      modelValue: r.model_value,
      officerValue: r.officer_value,
      modelSource: r.model_source,
      report: parseJson(r.snapshot, null),
    })),
  });
}
