import { ContractError, parseTextAnalysis } from "@/lib/integrations/contracts";
import { integrationAuth } from "@/lib/integrations/auth";
import { applyTextAnalysis, setIntegrationStatus } from "@/lib/repo/reports";

type Item = { reportId?: unknown; analysis?: unknown; error?: unknown };

/**
 * Submit LLM text analyses.
 *   { "reportId": 123, "analysis": { category, categoryConfidence, severity, keyFeatures, flags, summary, duplicateOf, model } }
 * or a batch: { "results": [ ...same objects... ] }
 * Send { "reportId": 123, "error": "..." } to mark a report as failed.
 */
export async function POST(request: Request) {
  const denied = await integrationAuth(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as (Item & { results?: Item[] }) | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });
  const items: Item[] = Array.isArray(body.results) ? body.results.slice(0, 500) : [body];

  const outcomes = items.map((item) => {
    const reportId = Number(item.reportId);
    if (!Number.isInteger(reportId)) return { reportId: item.reportId, ok: false, error: "reportId must be an integer" };
    if (item.error) {
      setIntegrationStatus([reportId], "llm_status", "failed");
      return { reportId, ok: true, status: "failed" };
    }
    try {
      const report = applyTextAnalysis(reportId, parseTextAnalysis(item.analysis));
      if (!report) return { reportId, ok: false, error: "Report not found" };
      return { reportId, ok: true, category: report.category, priorityScore: report.priorityScore, priorityBand: report.priorityBand, needsReview: report.needsReview };
    } catch (err) {
      if (err instanceof ContractError) return { reportId, ok: false, error: err.message };
      throw err;
    }
  });
  const failed = outcomes.filter((o) => !o.ok).length;
  return Response.json({ accepted: outcomes.length - failed, rejected: failed, results: outcomes }, { status: failed && failed === outcomes.length ? 422 : 200 });
}
