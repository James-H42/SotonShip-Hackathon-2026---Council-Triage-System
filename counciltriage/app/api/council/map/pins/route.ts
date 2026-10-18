import { gzipSync } from "node:zlib";
import { officerOrUnauthorized } from "@/lib/auth";
import { mapPins, searchReports } from "@/lib/repo/reports";
import { parseSearchParams } from "@/lib/search-params";
import { CATEGORY_IDS } from "@/lib/taxonomy";
import { BAND_ORDER } from "@/lib/triage/priority";

/**
 * Report pins for the map. Accepts the same filters as the dashboard (category, ward, status, band, queue, q, ...).
 *   default         GeoJSON FeatureCollection
 *   ?format=compact {total, bands, categories, pins: [id, lat*1e5, lon*1e5, bandIndex, categoryIndex, score][]}
 */
export async function GET(request: Request) {
  const officer = await officerOrUnauthorized();
  if (officer instanceof Response) return officer;
  const params = new URL(request.url).searchParams;
  const limit = Math.min(Number(params.get("limit") ?? 5000) || 5000, 20000);
  const filters = parseSearchParams(params);
  const pins = mapPins(filters, limit);

  if (params.get("format") === "compact") {
    const categories = [...CATEGORY_IDS, "tbc"];
    const body = JSON.stringify({
      total: searchReports({ ...filters, pageSize: 1 }).total,
      bands: BAND_ORDER,
      categories,
      pins: pins.map((p) => [p.id, Math.round(p.lat * 1e5), Math.round(p.lon * 1e5), BAND_ORDER.indexOf(p.priorityBand), categories.indexOf(p.category), Math.round(p.priorityScore)]),
    });
    const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store", vary: "accept-encoding" };
    // Route handlers are not compressed automatically; pins are the dashboard's largest response.
    if ((request.headers.get("accept-encoding") ?? "").includes("gzip")) {
      return new Response(new Uint8Array(gzipSync(body, { level: 6 })), { headers: { ...headers, "content-encoding": "gzip" } });
    }
    return new Response(body, { headers });
  }

  return Response.json({
    type: "FeatureCollection",
    features: pins.map((p) => ({
      type: "Feature",
      id: p.id,
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { ...p, href: `/council/reports/${p.id}` },
    })),
  });
}
