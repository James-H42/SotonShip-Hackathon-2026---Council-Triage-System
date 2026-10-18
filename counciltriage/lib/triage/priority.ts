/**
 * Priority scoring.
 *
 * The Incident Risk Priority Score (see computePriority) plus council policy:
 * pothole intervention depths (taxonomy potholeClass), response targets per band
 * and an itemised explanation officers can audit.
 */
import { potholeClass, type Answers, type EffectiveCategoryId } from "../taxonomy";
import { areRelated } from "./text";
import type { Flag, ImageAnalysis, PriorityBand, PriorityFactor, PriorityResult, TextAnalysis, TriageInput } from "./types";

const BAND_TARGETS: Record<PriorityBand, { label: string; hours: number | null }> = {
  critical: { label: "Within 24 hours", hours: 24 },
  high: { label: "Within 5 working days", hours: 24 * 7 },
  medium: { label: "Within 28 days", hours: 24 * 28 },
  low: { label: "Within 3 months", hours: 24 * 90 },
  monitor: { label: "Monitored only", hours: null },
};

export const BAND_ORDER: PriorityBand[] = ["critical", "high", "medium", "low", "monitor"];

/** Score (0-100) at or above which an incident is critical: the formula's 0.6 alert cut-off. */
export const CRITICAL_SCORE = 60;
/** An incident with a reported injury is never below high priority. */
export const INJURY_FLOOR = 45;

export function bandForScore(score: number): Exclude<PriorityBand, "monitor"> {
  if (score >= CRITICAL_SCORE) return "critical";
  if (score >= 45) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function has(answers: Answers, key: string, value: string): boolean {
  const v = answers[key];
  return Array.isArray(v) ? v.includes(value) : v === value;
}

function answerFactors(category: EffectiveCategoryId, a: Answers): PriorityFactor[] {
  const f: PriorityFactor[] = [];
  const add = (points: number, factor: string, detail?: string) => f.push({ factor, points, detail });
  switch (category) {
    case "pothole": {
      const cls = potholeClass(a);
      if (cls === "URGENT") add(30, "Council policy: urgent depth", "Above the 24-hour repair intervention level");
      else if (cls === "STANDARD") add(12, "Council policy: standard depth", "Repair within 6 months");
      if (has(a, "pothole_width", "large")) add(5, "Larger than a dustbin lid");
      break;
    }
    case "road_pavement_damage":
      if (has(a, "trip_hazard", "yes")) add(12, "Reported trip or fall hazard");
      if (has(a, "damage_type", "cover")) add(8, "Damaged or missing cover");
      if (has(a, "damage_surface", "road")) add(4, "Damage in the carriageway");
      break;
    case "fly_tipping":
      if (has(a, "waste_types", "hazardous")) add(20, "Hazardous waste reported");
      if (has(a, "waste_amount", "lorry")) add(14, "Lorry load or more");
      else if (has(a, "waste_amount", "van")) add(8, "Small van load");
      else if (has(a, "waste_amount", "car_boot")) add(4, "Car boot load");
      if (has(a, "waste_obstruction", "yes")) add(10, "Blocking a pavement, road or entrance");
      break;
    case "litter":
      if (has(a, "litter_type", "glass")) add(12, "Broken glass");
      if (has(a, "litter_extent", "wide")) add(6, "Affects a wide area");
      break;
    case "vandalism":
      if (has(a, "vandalism_offensive", "yes")) add(15, "Offensive content (council aims to remove quickly)");
      if (has(a, "vandalism_size", "large")) add(4, "Large area");
      break;
    case "street_light":
      if (has(a, "light_fault", "exposed")) add(35, "Exposed wiring or open door (electrical danger)");
      else if (has(a, "light_fault", "damaged")) add(15, "Damaged or leaning column");
      if (has(a, "light_count", "several")) add(8, "Several lights out");
      break;
    case "bus_shelter":
      if (has(a, "shelter_glass_on_ground", "yes")) add(15, "Broken glass on the ground");
      else if (has(a, "shelter_damage", "glass")) add(6, "Broken glass panel");
      if (has(a, "shelter_damage", "structure")) add(8, "Structural damage");
      break;
  }
  return f;
}

/**
 * Incident Risk Priority Score (team formula, adjusted after calibration; README "Prioritisation").
 *
 *   S'  text severity      = LLM urgency (1..5) -> (u-1)/4, or keyword severity; never below the form answers
 *   St' image severity     = vision severity_score, used only when the image is confident and on-topic
 *   sev = max(S', St')                                   (S' alone when there is no usable image)
 *   p   = 0.5 ^ (d / D_TARGET)   d = metres to the nearest key road (motorway, trunk, primary)
 *   λ   = p * sev                                        road-proximity impact
 *   i'  = i / (i + K)            i = injuries per week across the merged incident
 *   c   = (v + 0.5) / (n + 1)    v = reports mentioning vulnerable people, n = reports in the incident
 *   r   = 1 - 0.5 ^ ((n - 1) / 2)                        corroboration by duplicate reports
 *
 *   with image:    score = 0.15 S' + 0.20 St' + 0.30 λ + 0.15 i' + 0.10 c + 0.10 r
 *   without image: score = 0.35 S'            + 0.30 λ + 0.15 i' + 0.10 c + 0.10 r
 *
 * Overrides: sev > 0.9 escalates to critical regardless of score; a reported injury is at least
 * high (45). Council pothole policy
 * (intervention depths) still sets the floor/cap. Displayed as 0-100.
 */
export const RISK = {
  D_TARGET: 100,
  K: 2,
  ESCALATE_SEVERITY: 0.9,
  WITH_IMAGE: { textSeverity: 0.15, imageSeverity: 0.2, roadImpact: 0.3, injury: 0.15, vulnerable: 0.1, volume: 0.1 },
  NO_IMAGE: { textSeverity: 0.35, imageSeverity: 0, roadImpact: 0.3, injury: 0.15, vulnerable: 0.1, volume: 0.1 },
  /** Image evidence is ignored above this uncertainty (0 certain .. 1 uncertain). */
  MAX_IMAGE_UNCERTAINTY: 0.7,
} as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Severity implied by the resident's structured answers and hazard rating (0..1). */
function formSeverity(category: EffectiveCategoryId, input: TriageInput): { value: number; reasons: string[] } {
  const f = answerFactors(category, input.answers);
  let value = clamp01(f.reduce((n, x) => n + x.points, 0) / 35);
  if (input.hazardLevel === "high") value = Math.max(value, 0.75);
  else if (input.hazardLevel === "medium") value = Math.max(value, 0.5);
  const reasons = f.map((x) => x.factor);
  if (input.hazardLevel === "high") reasons.push("Resident: immediate danger");
  else if (input.hazardLevel === "medium") reasons.push("Resident: could cause injury or damage");
  return { value, reasons };
}

export function computePriority(args: {
  input: TriageInput;
  category: EffectiveCategoryId;
  text: TextAnalysis | null;
  images: ImageAnalysis[];
  flags: Flag[];
  now?: Date;
}): PriorityResult {
  const { input, category, text, images, flags } = args;
  const cluster = input.cluster;
  const n = Math.max(1, cluster?.reports ?? 1 + input.supporters);

  // S': text severity (LLM urgency when available).
  const ownText = text ? (typeof text.urgency === "number" ? clamp01((text.urgency - 1) / 4) : clamp01(text.severity)) : 0;
  const form = formSeverity(category, input);
  const textSeverity = Math.max(ownText, form.value, cluster?.maxTextSeverity ?? 0);

  // St': only confident, on-topic image evidence counts.
  const usable = images.filter(
    (i) =>
      i.severity !== null &&
      (i.uncertainty ?? 1 - i.categoryConfidence) <= RISK.MAX_IMAGE_UNCERTAINTY &&
      (i.category === null || category === "tbc" || areRelated(i.category, category)),
  );
  const ownImage = usable.length ? Math.max(...usable.map((i) => i.severity ?? 0)) : null;
  const imageSeverity = ownImage ?? cluster?.maxImageSeverity ?? null;
  const hasImage = imageSeverity !== null;
  const severity = hasImage ? Math.max(textSeverity, imageSeverity) : textSeverity;

  const d = input.geoContext.majorRoad?.distanceMetres ?? null;
  const proximity = d === null ? 0 : Math.pow(0.5, d / RISK.D_TARGET);
  const roadImpact = proximity * severity;

  const ownInjury = text?.injury ? 1 : 0;
  const injuriesPerWeek = cluster ? cluster.injuriesPerWeek : ownInjury;
  const injuryTerm = injuriesPerWeek / (injuriesPerWeek + RISK.K);
  const v = cluster ? cluster.vulnerable : text?.vulnerable ? 1 : 0;
  const vulnerableTerm = (v + 0.5) / (n + 1);
  const volumeTerm = 1 - Math.pow(0.5, (n - 1) / 2);

  const w = hasImage ? RISK.WITH_IMAGE : RISK.NO_IMAGE;
  let raw =
    w.textSeverity * textSeverity +
    w.imageSeverity * (imageSeverity ?? 0) +
    w.roadImpact * roadImpact +
    w.injury * injuryTerm +
    w.vulnerable * vulnerableTerm +
    w.volume * volumeTerm;

  const factors: PriorityFactor[] = [];
  const add = (weight: number, value: number, factor: string, detail?: string) => {
    const points = Math.round(weight * value * 1000) / 10;
    if (points !== 0) factors.push({ factor, points, detail });
  };
  const textDetail =
    typeof text?.urgency === "number"
      ? `LLM urgency ${text.urgency}/5`
      : text
        ? `${text.source === "llm" ? "LLM" : "Keyword"} severity ${Math.round(ownText * 100)}%`
        : undefined;
  add(w.textSeverity, textSeverity, "Text severity (S')", [textDetail, ...form.reasons].filter(Boolean).join("; ") || undefined);
  if (hasImage) add(w.imageSeverity, imageSeverity, "Image severity (St')", usable[0]?.severityLabel ? `Image model: ${usable[0].severityLabel} severity` : "From a merged report's photo");
  add(
    w.roadImpact,
    roadImpact,
    "Key-road proximity (λ)",
    d === null ? "No key road nearby" : `${Math.round(d)} m from ${input.geoContext.majorRoad?.name ?? "a key road"} (impact ${Math.round(proximity * 100)}%)`,
  );
  add(w.injury, injuryTerm, "Injuries (i')", injuriesPerWeek ? `${Math.round(injuriesPerWeek * 10) / 10} injur${injuriesPerWeek === 1 ? "y" : "ies"} per week` : undefined);
  add(w.vulnerable, vulnerableTerm, "Vulnerable people (c)", v ? `${v} of ${n} report(s) mention vulnerable people` : "None mentioned");
  add(w.volume, volumeTerm, "Corroborating reports (r)", n > 1 ? `${n} reports of this problem${input.supporters > 0 ? ", including residents who confirmed it is the same" : ""}` : undefined);

  // Moderation multipliers: dubious or irrelevant evidence lowers, never removes, priority.
  if (flags.some((f) => f.dubious)) {
    factors.push({ factor: "Flagged as possibly dubious", points: -Math.round(raw * 40) / 10, detail: "Score x0.6" });
    raw *= 0.6;
  }
  if (flags.some((f) => f.code === "image_no_issue")) {
    factors.push({ factor: "Photo does not show a problem", points: -Math.round(raw * 20) / 10, detail: "Score x0.8" });
    raw *= 0.8;
  }

  let score = clamp01(raw) * 100;
  let override: string | undefined;
  const cls = category === "pothole" ? potholeClass(input.answers) : null;
  let band: PriorityBand;
  let responseTarget: string;
  let targetHours: number | null;
  if (cls === "URGENT" || severity > RISK.ESCALATE_SEVERITY) {
    override = cls === "URGENT" ? "Council policy: urgent pothole depth" : `Severity ${Math.round(severity * 100)}% > 90%: escalate immediately`;
    if (score < CRITICAL_SCORE) factors.push({ factor: override, points: Math.round((CRITICAL_SCORE - score) * 10) / 10 });
    score = Math.max(score, CRITICAL_SCORE);
    band = "critical";
    responseTarget = "Within 24 hours";
    targetHours = 24;
  } else if (injuriesPerWeek > 0 && score < INJURY_FLOOR && !flags.some((f) => f.dubious)) {
    // Someone has actually been hurt: never below high priority, whatever the other terms say.
    override = "Injury reported: at least high priority";
    factors.push({ factor: override, points: Math.round((INJURY_FLOOR - score) * 10) / 10 });
    score = INJURY_FLOOR;
    band = "high";
    responseTarget = BAND_TARGETS.high.label;
    targetHours = BAND_TARGETS.high.hours;
  } else if (cls === "MONITOR" && !flags.some((f) => f.code === "officer_flagged")) {
    override = "Council policy: below intervention depth";
    score = Math.min(score, 25);
    band = "monitor";
    responseTarget = "Monitored only";
    targetHours = null;
  } else if (cls === "STANDARD") {
    band = bandForScore(score);
    responseTarget = band === "critical" || band === "high" ? BAND_TARGETS[band].label : "Within 6 months";
    targetHours = band === "critical" || band === "high" ? BAND_TARGETS[band].hours : 24 * 182;
  } else {
    band = bandForScore(score);
    responseTarget = BAND_TARGETS[band].label;
    targetHours = BAND_TARGETS[band].hours;
  }

  return {
    score: Math.round(score),
    band,
    responseTarget,
    targetHours,
    factors,
    risk: {
      textSeverity,
      imageSeverity,
      severity,
      roadDistanceMetres: d,
      proximity,
      roadImpact,
      injuriesPerWeek,
      injuryTerm,
      vulnerableTerm,
      volumeTerm,
      weights: { ...w },
      raw: Math.round(raw * 1000) / 1000,
      override,
    },
  };
}

export function targetForBand(band: PriorityBand) {
  return BAND_TARGETS[band];
}
