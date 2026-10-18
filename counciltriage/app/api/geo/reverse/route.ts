import { MAJOR_ROAD_THRESHOLD_M, nearestMajorRoad, wardFor } from "@/lib/geo";
import type { ReverseResponse } from "@/lib/geo-search";
import { nearestPostcode, reverseAddress } from "../_lib/external";

/**
 * What is at this point: ward, nearest postcode (postcodes.io), street address
 * (Nominatim) and the nearest key road. External lookups are optional; a failure
 * just leaves that field null.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Round to ~1 m so nearby taps share cache entries.
  const lat = Math.round(Number(params.get("lat")) * 1e5) / 1e5;
  const lon = Math.round(Number(params.get("lon")) * 1e5) / 1e5;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !params.get("lat") || !params.get("lon")) {
    return Response.json({ error: "lat and lon are required" }, { status: 400 });
  }
  const p = { lat, lon };
  const ward = wardFor(p);
  const road = nearestMajorRoad(p);
  const [postcode, address] = ward
    ? await Promise.all([
        nearestPostcode(lat, lon).catch((err) => (console.error("[geo/reverse] postcodes.io", err), null)),
        reverseAddress(lat, lon).catch((err) => (console.error("[geo/reverse] nominatim", err), null)),
      ])
    : [null, null];
  return Response.json({
    inSouthampton: ward !== null,
    ward,
    postcode,
    address,
    majorRoad: road ? { ...road, near: road.distanceMetres <= MAJOR_ROAD_THRESHOLD_M } : null,
  } satisfies ReverseResponse);
}
