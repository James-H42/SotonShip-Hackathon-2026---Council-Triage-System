import { isInSouthampton, nearestMajorRoad, WARD_SOURCE, wardFor } from "@/lib/geo";

/** Ward and road context for a point (used by the resident form). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: "lat and lon are required" }, { status: 400 });
  const p = { lat, lon };
  return Response.json({
    inSouthampton: isInSouthampton(p),
    ward: wardFor(p),
    wardSource: WARD_SOURCE,
    majorRoad: nearestMajorRoad(p),
  });
}
