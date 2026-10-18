import { ContractError, parseImageAnalysis } from "@/lib/integrations/contracts";
import { integrationAuth } from "@/lib/integrations/auth";
import { applyImageAnalysis, getPhoto, setIntegrationStatus } from "@/lib/repo/reports";

type Item = { photoId?: unknown; analysis?: unknown; error?: unknown };

/**
 * Submit image-model results, one per photo.
 *   { "photoId": 45, "analysis": { category, categoryConfidence, severity, labels, notes, model } }
 * or a batch: { "results": [ ... ] }
 */
export async function POST(request: Request) {
  const denied = await integrationAuth(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as (Item & { results?: Item[] }) | null;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });
  const items: Item[] = Array.isArray(body.results) ? body.results.slice(0, 500) : [body];

  const outcomes = items.map((item) => {
    const photoId = Number(item.photoId);
    const photo = Number.isInteger(photoId) ? getPhoto(photoId) : null;
    if (!photo) return { photoId: item.photoId, ok: false, error: "Photo not found" };
    if (item.error) {
      setIntegrationStatus([photo.reportId], "vision_status", "failed");
      return { photoId, ok: true, status: "failed" };
    }
    try {
      const report = applyImageAnalysis(photoId, parseImageAnalysis(item.analysis));
      return { photoId, reportId: photo.reportId, ok: true, category: report?.category, priorityScore: report?.priorityScore, priorityBand: report?.priorityBand };
    } catch (err) {
      if (err instanceof ContractError) return { photoId, ok: false, error: err.message };
      throw err;
    }
  });
  const failed = outcomes.filter((o) => !o.ok).length;
  return Response.json({ accepted: outcomes.length - failed, rejected: failed, results: outcomes }, { status: failed && failed === outcomes.length ? 422 : 200 });
}
