/**
 * The Southampton City Council area as a bounding box: browser-safe (no file access), shared by
 * the server geography (lib/geo.ts), form validation and the map components. The exact ward
 * boundary is checked separately (lib/geo.ts wardFor on the server, the boundary file in the map).
 */
export type LatLon = { lat: number; lon: number };

export const SOUTHAMPTON_BOUNDS = { minLat: 50.865, maxLat: 50.962, minLon: -1.49, maxLon: -1.315 };
export const SOUTHAMPTON_CENTRE: LatLon = { lat: 50.9097, lon: -1.4044 };

export function isInSouthampton(p: LatLon): boolean {
  const b = SOUTHAMPTON_BOUNDS;
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon;
}
