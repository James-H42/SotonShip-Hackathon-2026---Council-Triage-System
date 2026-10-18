import { reportSummary } from "@/lib/public-summary";
import { nearbyOpenReports } from "@/lib/repo/reports";
import { isCategoryId } from "@/lib/taxonomy";

/**
 * Open reports near a point (optionally of one category): lets residents check for an existing
 * report before submitting. Returns only the privacy-safe summary of each report.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: "lat and lon are required" }, { status: 400 });
  const category = params.get("category");
  const radius = Math.min(Math.max(Number(params.get("radius") ?? 150) || 150, 10), 1000);
  const results = nearbyOpenReports(lat, lon, {
    radiusMetres: radius,
    category: category && isCategoryId(category) ? category : undefined,
    limit: 10,
  }).filter((x) => !x.report.dubious);
  return Response.json({
    radiusMetres: radius,
    items: results.map((x) => ({ distanceMetres: x.distanceMetres, report: reportSummary(x.report) })),
  });
}
