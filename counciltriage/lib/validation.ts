/**
 * Resident report validation, shared by the browser form and the API.
 * Must stay free of Node-only imports.
 */
import { isInSouthampton } from "./bounds";
import {
  CATEGORY_BY_ID,
  HAZARD_LEVELS,
  isCategoryId,
  visibleQuestions,
  type Answers,
  type CategoryId,
  type HazardLevel,
} from "./taxonomy";


export type ReportDraft = {
  category: string;
  serviceName: string;
  customType: string;
  title: string;
  detail: string;
  answers: Answers;
  hazardLevel: string;
  lat: string | number | null;
  lon: string | number | null;
  noMap: boolean;
  /** "photo" when the point came from the photos' GPS data (lib/photo-location.ts). */
  locationSource?: "map" | "photo";
  locationText: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  privacyAccepted: boolean;
};

export type ValidReport = {
  category: CategoryId;
  serviceName: string;
  customType: string | null;
  title: string;
  detail: string;
  answers: Answers;
  hazardLevel: HazardLevel | null;
  lat: number | null;
  lon: number | null;
  locationPrecision: "exact" | "approximate";
  locationSource: "map" | "photo";
  locationText: string | null;
  contact: { firstName: string; lastName: string; email: string; phone: string | null };
};

export type FieldErrors = Record<string, string>;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UK_PHONE_RE = /^(\+44\s?|0)(\d\s?){9,10}$/;

export function emptyDraft(): ReportDraft {
  return {
    category: "",
    serviceName: "",
    customType: "",
    title: "",
    detail: "",
    answers: {},
    hazardLevel: "",
    lat: null,
    lon: null,
    noMap: false,
    locationSource: "map",
    locationText: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    privacyAccepted: false,
  };
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function inSouthampton(lat: number, lon: number) {
  return isInSouthampton({ lat, lon });
}

export function validateCategory(d: ReportDraft): FieldErrors {
  const e: FieldErrors = {};
  if (!isCategoryId(d.category)) {
    e.category = "Choose the type of problem.";
    return e;
  }
  const def = CATEGORY_BY_ID[d.category];
  if (def.services.length > 1 && !def.services.includes(d.serviceName)) e.serviceName = "Choose the option that best describes the problem.";
  if (d.category === "other" && d.serviceName === "Other" && d.customType.trim().length < 3) {
    e.customType = "Tell us what kind of problem it is.";
  }
  return e;
}

export function validateLocation(d: ReportDraft): FieldErrors {
  const e: FieldErrors = {};
  const lat = toNumber(d.lat);
  const lon = toNumber(d.lon);
  if (d.noMap) {
    if (d.locationText.trim().length < 10) e.locationText = "Describe where the problem is, including the street name.";
    if (lat !== null && lon !== null && !inSouthampton(lat, lon)) e.location = "That location is outside Southampton.";
    return e;
  }
  if (lat === null || lon === null) e.location = "Set the location of the problem.";
  else if (!inSouthampton(lat, lon)) e.location = "That location is outside the Southampton City Council area.";
  if (d.locationText.length > 300) e.locationText = "Keep the location description under 300 characters.";
  return e;
}

export function validateDetails(d: ReportDraft): FieldErrors {
  const e: FieldErrors = {};
  if (!isCategoryId(d.category)) return { category: "Choose the type of problem." };
  for (const q of visibleQuestions(d.category, d.answers)) {
    const v = d.answers[q.id];
    const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    if (q.required && empty) {
      e[`answers.${q.id}`] = q.type === "confirm" ? "You must confirm this statement." : "Answer this question.";
      continue;
    }
    if (empty) continue;
    if (q.options) {
      const values = Array.isArray(v) ? v : [v];
      if (values.some((x) => !q.options!.some((o) => o.value === x))) e[`answers.${q.id}`] = "Choose one of the options.";
    }
    if (q.type === "text" && typeof v === "string" && q.maxLength && v.length > q.maxLength) {
      e[`answers.${q.id}`] = `Keep this under ${q.maxLength} characters.`;
    }
    if (q.type === "confirm" && v !== "true") e[`answers.${q.id}`] = "You must confirm this statement.";
  }
  if (!HAZARD_LEVELS.some((h) => h.value === d.hazardLevel)) e.hazardLevel = "Tell us how serious the problem is.";
  const title = d.title.trim();
  if (title.length < 5) e.title = "Give your report a short title (at least 5 characters).";
  else if (title.length > 120) e.title = "Keep the title under 120 characters.";
  const detail = d.detail.trim();
  if (detail.length < 10) e.detail = "Describe the problem (at least 10 characters).";
  else if (detail.length > 3000) e.detail = "Keep the description under 3,000 characters.";
  return e;
}

export function validateContact(d: ReportDraft): FieldErrors {
  const e: FieldErrors = {};
  if (!d.firstName.trim()) e.firstName = "Enter your first name.";
  if (!d.lastName.trim()) e.lastName = "Enter your surname.";
  if (!EMAIL_RE.test(d.email.trim())) e.email = "Enter a valid email address.";
  if (d.phone.trim() && !UK_PHONE_RE.test(d.phone.trim())) e.phone = "Enter a valid UK phone number.";
  if (!d.privacyAccepted) e.privacyAccepted = "Confirm you have read how we use your information.";
  return e;
}

export function validateDraft(d: ReportDraft): { ok: true; value: ValidReport } | { ok: false; errors: FieldErrors } {
  const errors = { ...validateCategory(d), ...validateLocation(d), ...validateDetails(d), ...validateContact(d) };
  if (Object.keys(errors).length) return { ok: false, errors };
  const category = d.category as CategoryId;
  const def = CATEGORY_BY_ID[category];
  const allowed = new Set(visibleQuestions(category, d.answers).map((q) => q.id));
  const answers: Answers = Object.fromEntries(Object.entries(d.answers).filter(([k]) => allowed.has(k)));
  const lat = toNumber(d.lat);
  const lon = toNumber(d.lon);
  const hasPoint = lat !== null && lon !== null;
  return {
    ok: true,
    value: {
      category,
      serviceName: def.services.includes(d.serviceName) ? d.serviceName : def.services[0],
      customType: category === "other" && d.customType.trim() ? d.customType.trim().slice(0, 80) : null,
      title: d.title.trim(),
      detail: d.detail.trim(),
      answers,
      hazardLevel: d.hazardLevel as HazardLevel,
      lat: hasPoint ? lat : null,
      lon: hasPoint ? lon : null,
      locationPrecision: d.locationSource === "photo" && hasPoint ? "exact" : d.noMap || !hasPoint ? "approximate" : "exact",
      locationSource: d.locationSource === "photo" && hasPoint ? "photo" : "map",
      locationText: d.locationText.trim() || null,
      contact: {
        firstName: d.firstName.trim().slice(0, 60),
        lastName: d.lastName.trim().slice(0, 60),
        email: d.email.trim().toLowerCase(),
        phone: d.phone.trim() || null,
      },
    },
  };
}
