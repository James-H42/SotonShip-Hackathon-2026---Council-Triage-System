/** Parse report filters from URL search params (pages and API routes share this). */
import type { ReportFilters } from "./repo/reports";

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function getter(src: ParamSource) {
  return (key: string): string | undefined => {
    if (src instanceof URLSearchParams) return src.get(key) ?? undefined;
    const v = src[key];
    return Array.isArray(v) ? v[0] : v;
  };
}

const SORTS = ["priority", "newest", "oldest", "due"] as const;
const QUEUES = ["review", "dubious", "duplicates", "unscheduled"] as const;

export function parseSearchParams(src: ParamSource, opts: { defaultSort?: ReportFilters["sort"]; defaultStatus?: string } = {}): ReportFilters {
  const get = getter(src);
  const num = (k: string) => {
    const v = get(k);
    const n = v === undefined || v === "" ? NaN : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const sort = get("sort");
  const queue = get("queue");
  const near = get("near");
  let nearValue: ReportFilters["near"];
  if (near) {
    const [lat, lon] = near.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) nearValue = { lat, lon, radiusMetres: Math.min(num("radius") ?? 500, 5000) };
  }
  return {
    q: get("q")?.slice(0, 200) || undefined,
    category: get("category") || undefined,
    service: get("service") || undefined,
    ward: get("ward") || undefined,
    status: get("status") || opts.defaultStatus || "open",
    band: get("band") || undefined,
    source: get("source") || undefined,
    queue: (QUEUES as readonly string[]).includes(queue ?? "") ? (queue as ReportFilters["queue"]) : undefined,
    hasPhoto: get("photo") === "1" || undefined,
    near: nearValue,
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as ReportFilters["sort"]) : (opts.defaultSort ?? "priority"),
    page: num("page") ?? 1,
    pageSize: num("pageSize"),
  };
}

/** Build a query string from filters, dropping empty values (for links and pagination). */
export function toQuery(params: Record<string, string | number | undefined | null | boolean>, overrides: Record<string, string | number | undefined | null> = {}) {
  const merged = { ...params, ...overrides };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    qs.set(k, String(v === true ? 1 : v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}
