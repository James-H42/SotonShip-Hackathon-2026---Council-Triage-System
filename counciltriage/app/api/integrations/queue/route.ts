import { integrationAuth } from "@/lib/integrations/auth";
import { llmRequestFor, TAXONOMY_SUMMARY } from "@/lib/integrations/dispatch";
import { getPhotos, integrationQueue, photoUrl, setIntegrationStatus } from "@/lib/repo/reports";

/**
 * Pull mode for the external AI services.
 *   GET /api/integrations/queue?stage=llm&limit=50&after=0&claim=1
 * `claim=1` marks the returned reports as `processing` so parallel workers do not repeat them.
 * Use the last returned id as `after` to page through the backlog.
 */
export async function GET(request: Request) {
  const denied = await integrationAuth(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const stage = params.get("stage") === "vision" ? "vision" : "llm";
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 500);
  const after = Number(params.get("after") ?? 0) || 0;
  const reports = integrationQueue(stage, limit, after);
  if (params.get("claim") === "1") setIntegrationStatus(reports.map((r) => r.id), stage === "llm" ? "llm_status" : "vision_status", "processing");

  const origin = new URL(request.url).origin;
  const items =
    stage === "llm"
      ? reports.map((r) => ({ reportId: r.id, ...llmRequestFor(r), taxonomy: undefined }))
      : reports.map((r) => ({
          reportId: r.id,
          ref: r.ref,
          residentCategory: r.residentCategory,
          photos: getPhotos(r.id)
            .filter((p) => !p.analysis)
            .map((p) => ({ photoId: p.id, url: origin + photoUrl(p.id), mime: p.mime })),
        }));
  return Response.json({
    stage,
    count: items.length,
    nextAfter: reports.length ? reports[reports.length - 1].id : null,
    taxonomy: TAXONOMY_SUMMARY,
    resultEndpoint: stage === "llm" ? "/api/integrations/llm-results" : "/api/integrations/vision-results",
    items,
  });
}
