import { classifyQuery, parseCoords, type SearchResponse } from "@/lib/geo-search";
import { insideCity, lookupOutcode, lookupPostcode, searchPlaces } from "../_lib/external";

/**
 * Location search for the resident form: a Southampton postcode (postcodes.io)
 * or a street/place name (Nominatim, bounded to the city). what3words
 * addresses go to /api/geo/what3words.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const query = classifyQuery(q);
  if (!query) return Response.json({ results: [], error: "Type a postcode, street or place name." } satisfies SearchResponse, { status: 400 });
  if (query.kind === "what3words") {
    return Response.json({ results: [], error: "Use /api/geo/what3words for what3words addresses." } satisfies SearchResponse, { status: 400 });
  }
  if (query.kind === "coords") {
    const p = parseCoords(query.value)!;
    if (!insideCity(p)) {
      return Response.json({ results: [], message: `${p.lat}, ${p.lon} is outside Southampton City Council's area.` } satisfies SearchResponse);
    }
    return Response.json({ results: [{ label: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`, detail: "Latitude and longitude", ...p, source: "coords" }] } satisfies SearchResponse);
  }
  try {
    if (query.kind === "postcode" || query.kind === "outcode") {
      const { result, reason } = query.kind === "postcode" ? await lookupPostcode(query.value) : await lookupOutcode(query.value);
      return Response.json({ results: result ? [result] : [], message: reason } satisfies SearchResponse);
    }
    const results = await searchPlaces(query.value);
    return Response.json({
      results,
      message: results.length ? undefined : `No match for "${query.value}" in Southampton. Try a street name, a postcode, or tap the map.`,
    } satisfies SearchResponse);
  } catch (err) {
    console.error("[geo/search]", err);
    return Response.json(
      { results: [], error: "Address search is not available right now. Tap the map or use your current location instead." } satisfies SearchResponse,
      { status: 502 },
    );
  }
}
