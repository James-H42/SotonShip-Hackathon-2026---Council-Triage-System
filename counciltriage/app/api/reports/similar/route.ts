import { sameProblem } from "@/lib/ai/ollama";
import { reportSummary } from "@/lib/public-summary";
import { nearbyOpenReports } from "@/lib/repo/reports";
import { isCategoryId } from "@/lib/taxonomy";

/**
 * Before sending: does this draft describe a problem that is already reported?
 * Open reports of the same category within 150 m are shortlisted, then the local LLM compares
 * the resident's words with each one. Only the privacy-safe summary is returned.
 * If the LLM is unavailable, very close reports (within 40 m) are offered instead.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { lat?: number; lon?: number; category?: string; title?: string; detail?: string };
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: "lat and lon are required" }, { status: 400 });
  const category = body.category && isCategoryId(body.category) ? body.category : undefined;
  const draft = { title: String(body.title ?? "").slice(0, 200), detail: String(body.detail ?? "").slice(0, 2000) };
  const shortlist = nearbyOpenReports(lat, lon, { radiusMetres: 150, category, limit: 3 }).filter((x) => !x.report.dubious);
  const matches = [];
  for (const c of shortlist) {
    const same = draft.title || draft.detail ? await sameProblem(draft, { title: c.report.title, detail: c.report.detail }, c.distanceMetres) : null;
    if (same === true || (same === null && c.distanceMetres <= 40)) {
      matches.push({ distanceMetres: c.distanceMetres, checkedBy: same === null ? "distance" : "llm", report: reportSummary(c.report) });
    }
  }
  return Response.json({ checked: shortlist.length, items: matches });
}
