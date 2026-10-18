import { DEFAULT_ROUTE_OPTIONS, type RouteOptions } from "./routing";
import type { JobSelection } from "./repo/workorders";

type Source = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (Array.isArray(v)) return str(v[0]);
  return typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : undefined;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(str(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

/** Route planner inputs from a URL query or JSON body. Staff work in pairs, so crews = staff / 2. */
export function routeOptionsFrom(src: Source): {
  selection: JobSelection;
  options: Partial<RouteOptions>;
  staff: number;
  shiftHours: number;
  jobsPerCrew: number;
} {
  const staff = Math.round(num(src.staff, 4, 2, 40) / 2) * 2;
  const shiftHours = num(src.shiftHours, 7.5, 1, 12);
  const wardsRaw = src.wards ?? src.ward;
  const wards = (Array.isArray(wardsRaw) ? wardsRaw : typeof wardsRaw === "string" ? wardsRaw.split(",") : [])
    .map((w) => String(w).trim())
    .filter(Boolean);
  const jobsPerCrew = num(src.jobsPerCrew, DEFAULT_ROUTE_OPTIONS.maxJobsPerCrew, 1, 7);
  return {
    staff,
    shiftHours,
    jobsPerCrew,
    selection: {
      category: str(src.category) ?? "all",
      minBand: str(src.minBand) ?? "medium",
      wards,
      limit: num(src.limit, 60, 1, 300),
      includeReview: str(src.includeReview) === "1" || src.includeReview === true,
    },
    options: {
      crews: staff / 2,
      shiftMinutes: shiftHours * 60,
      speedKmh: num(src.speedKmh, DEFAULT_ROUTE_OPTIONS.speedKmh, 5, 60),
      maxJobsPerCrew: jobsPerCrew,
    },
  };
}
