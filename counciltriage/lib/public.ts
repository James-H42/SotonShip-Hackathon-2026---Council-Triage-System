/** What residents and the public may see about a report. Never includes contact details or triage internals. */
import { publicText } from "./format";
import { getPhotos, getReport, photoUrl, type Report, type ReportEvent } from "./repo/reports";
import { STATUS_BY_ID } from "./statuses";
import { categoryLabel } from "./taxonomy";

export type PublicReport = ReturnType<typeof publicReport>;

export function publicCategory(r: Report) {
  return r.category === "tbc" ? r.residentCategory : r.category;
}

export function publicReport(r: Report, opts: { withPhotos?: boolean } = {}) {
  const category = publicCategory(r);
  const mergedInto = r.duplicateOf ? getReport(r.duplicateOf) : null;
  return {
    ref: r.ref,
    title: publicText(r.title),
    detail: publicText(r.detail),
    category,
    categoryLabel: categoryLabel(category),
    serviceName: r.serviceName,
    customType: r.customType,
    status: r.status,
    statusLabel: STATUS_BY_ID[r.status].label,
    open: STATUS_BY_ID[r.status].open,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lat: r.lat,
    lon: r.lon,
    locationText: r.locationText ? publicText(r.locationText) : null,
    locationPrecision: r.locationPrecision,
    ward: r.ward,
    source: r.source,
    hasPhoto: r.hasPhoto,
    photos: opts.withPhotos ? getPhotos(r.id).map((p) => photoUrl(p.id)) : [],
    supporters: r.supporters,
    responseTarget: STATUS_BY_ID[r.status].open ? r.responseTarget : null,
    mergedInto: mergedInto ? { ref: mergedInto.ref, title: publicText(mergedInto.title) } : null,
  };
}

export function publicEvent(e: ReportEvent) {
  return {
    at: e.createdAt,
    kind: e.kind,
    status: e.status,
    statusLabel: e.status ? STATUS_BY_ID[e.status].label : null,
    message: e.message ? publicText(e.message) : null,
    by: e.actorType === "officer" ? "Council officer" : e.actorType === "resident" ? "Resident" : "StreetTriage",
  };
}
