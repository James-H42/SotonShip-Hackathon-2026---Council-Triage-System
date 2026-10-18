/**
 * What a resident may see about SOMEONE ELSE'S report: enough to recognise the
 * problem (type, rough place, status, date), never what the reporter wrote,
 * photographed or answered. Their own reports use `publicReport` from ./public.
 */
import { publicCategory, publicEvent } from "./public";
import { getReport, type Report, type ReportEvent } from "./repo/reports";
import { STATUS_BY_ID } from "./statuses";
import { CATEGORY_BY_ID, categoryLabel, isCategoryId } from "./taxonomy";

/** A named main road counts as the "street" only when the report is close to it. */
const STREET_RADIUS_M = 150;

export type ReportSummary = ReturnType<typeof reportSummary>;

/** Rounds to 3 decimal places (about 110 m north-south), so a pin shows the area, not the doorstep. */
function approx(n: number) {
  return Math.round(n * 1000) / 1000;
}

function street(r: Report): string | null {
  const road = r.geoContext?.majorRoad;
  return road && road.distanceMetres <= STREET_RADIUS_M ? road.name : null;
}

/** A generic, computed title such as "Pothole near Portswood Road" or "Fly-tipping in Bevois". */
export function genericTitle(r: Report): string {
  const label = categoryLabel(publicCategory(r));
  const s = street(r);
  if (s) return `${label} near ${s}`;
  if (r.ward) return `${label} in ${r.ward}`;
  return label;
}

export function approxLocation(r: Report): string {
  const s = street(r);
  if (s && r.ward) return `Near ${s}, ${r.ward}`;
  if (s) return `Near ${s}`;
  return r.ward ? `${r.ward} ward` : "Southampton";
}

/** Only taxonomy service names (a fixed list) are shown, never a resident's own "other" wording. */
function safeServiceName(r: Report): string | null {
  const category = publicCategory(r);
  if (!isCategoryId(category)) return null;
  return CATEGORY_BY_ID[category].services.includes(r.serviceName) && r.serviceName !== "Other" ? r.serviceName : null;
}

export function reportSummary(r: Report) {
  const category = publicCategory(r);
  const mergedInto = r.duplicateOf ? getReport(r.duplicateOf) : null;
  return {
    ref: r.ref,
    title: genericTitle(r),
    category,
    categoryLabel: categoryLabel(category),
    serviceName: safeServiceName(r),
    status: r.status,
    statusLabel: STATUS_BY_ID[r.status].label,
    open: STATUS_BY_ID[r.status].open,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    approxLocation: approxLocation(r),
    ward: r.ward,
    lat: approx(r.lat),
    lon: approx(r.lon),
    supporters: r.supporters,
    responseTarget: STATUS_BY_ID[r.status].open ? r.responseTarget : null,
    mergedInto: mergedInto ? { ref: mergedInto.ref, title: genericTitle(mergedInto) } : null,
  };
}

/** Timeline for someone else's report: status changes and council messages, never the reporter's own words. */
export function summaryEvent(e: ReportEvent) {
  const pub = publicEvent(e);
  return e.actorType === "officer" ? pub : { ...pub, message: null };
}
