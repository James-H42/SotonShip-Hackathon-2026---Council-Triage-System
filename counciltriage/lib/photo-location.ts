/**
 * Where a report is, when its photos carry GPS (browser-safe, pure).
 *
 * - Only photo locations inside the Southampton boundary count (`inArea`).
 * - One usable photo location: use it.
 * - Several: if they all lie within PHOTO_AGREEMENT_M of the first, use the first photo's location.
 *   If they disagree, fall back to the location the resident chose on the map.
 * - None: the resident's choice.
 */
import type { LatLon } from "./exif";

/** Photos of one problem taken from different angles are rarely more than this far apart. */
export const PHOTO_AGREEMENT_M = 100;

export type PhotoLocationDecision =
  | { source: "photo"; point: LatLon; photos: number }
  | { source: "map"; reason: "no_gps" | "outside_area" | "photos_disagree"; spreadMetres?: number };

export function distanceMetres(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function choosePhotoLocation(photoPoints: (LatLon | null)[], inArea: (p: LatLon) => boolean): PhotoLocationDecision {
  const withGps = photoPoints.filter((p): p is LatLon => p !== null);
  if (!withGps.length) return { source: "map", reason: "no_gps" };
  const usable = withGps.filter(inArea);
  if (!usable.length) return { source: "map", reason: "outside_area" };
  const [first] = usable;
  const spread = Math.max(0, ...usable.map((p) => distanceMetres(first, p)));
  if (spread > PHOTO_AGREEMENT_M) return { source: "map", reason: "photos_disagree", spreadMetres: Math.round(spread) };
  return { source: "photo", point: first, photos: usable.length };
}
