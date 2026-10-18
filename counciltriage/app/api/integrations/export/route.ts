import { db } from "@/lib/db";
import { integrationAuth } from "@/lib/integrations/auth";
import { getPhotos, getReport, toFixMyStreetRecord } from "@/lib/repo/reports";

/**
 * Stream every report as JSON Lines in the FixMyStreet scrape schema (plus
 * extension fields), for model training and offline evaluation.
 *   GET /api/integrations/export?source=resident&status=open
 */
export async function GET(request: Request) {
  const denied = await integrationAuth(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const clauses: string[] = [];
  const args: string[] = [];
  const source = params.get("source");
  if (source) {
    clauses.push("source = ?");
    args.push(source);
  }
  if (params.get("status") === "open") clauses.push("status IN ('received','in_progress','repair_scheduled','monitoring')");
  const ids = (db().prepare(`SELECT id FROM reports ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY id`).all(...args) as { id: number }[]).map((r) =>
    Number(r.id),
  );

  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      const batch: string[] = [];
      for (let n = 0; n < 500 && i < ids.length; n++, i++) {
        const report = getReport(ids[i]);
        if (report) {
          const record = toFixMyStreetRecord(report, report.hasPhoto ? getPhotos(report.id) : []);
          batch.push(JSON.stringify({ ...record, triage: { category: report.category, priorityScore: report.priorityScore, priorityBand: report.priorityBand, flags: report.flags.map((f) => f.code) } }));
        }
      }
      if (batch.length) controller.enqueue(encoder.encode(batch.join("\n") + "\n"));
      if (i >= ids.length) controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "content-disposition": 'attachment; filename="reports.jsonl"' },
  });
}
