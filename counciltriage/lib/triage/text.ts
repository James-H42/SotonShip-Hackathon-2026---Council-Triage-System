/**
 * Built-in text analyser.
 *
 * A transparent keyword baseline that runs whenever the LLM service is not
 * configured or has not answered yet. It produces the same `TextAnalysis`
 * shape the LLM returns, so the rest of the pipeline treats both identically.
 */
import { CATEGORY_BY_ID, type CategoryId } from "../taxonomy";
import type { Flag, TextAnalysis, TriageInput } from "./types";

const CATEGORY_KEYWORDS: Record<CategoryId, RegExp[]> = {
  pothole: [/\bpot ?-?holes?\b/, /\bsink ?holes?\b/, /\bhole in the (road|pavement|street)\b/, /\bcraters?\b/],
  road_pavement_damage: [
    /\bslabs?\b/,
    /\bpaving\b/,
    /\bkerbs?\b|\bcurbs?\b/,
    /\bman ?holes?\b/,
    /\b(drain|inspection|bt|utility|access) covers?\b/,
    /\buneven\b/,
    /\bsunken\b/,
    /\broad surface\b|\btarmac\b|\bcarriageway\b/,
    /\b(road|white|yellow) (line|lines|marking|markings)\b/,
    /\bfoot ?(path|way)s?\b/,
    /\btrip(ping)? hazard\b/,
    /\bcracked\b|\bcrumbling\b/,
  ],
  fly_tipping: [
    /\bfly[ -]?tip(ping|ped)?\b/,
    /\bdump(ed|ing)\b/,
    /\bmattress(es)?\b/,
    /\bsofas?\b|\bsettees?\b|\bcouch\b/,
    /\bfridges?\b|\bfreezers?\b|\bwashing machine\b/,
    /\brubble\b/,
    /\bblack bags?\b|\bbin bags?\b/,
    /\basbestos\b/,
    /\btyres?\b/,
  ],
  litter: [
    /\blitter(ing)?\b/,
    /\brubbish\b/,
    /\boverflowing\b/,
    /\bbroken glass\b/,
    /\bcans\b|\bbottles\b|\bwrappers?\b/,
    /\bsweep(ing)?\b|\bstreet clean(ing)?\b/,
  ],
  vandalism: [/\bgraffit+i\b/, /\bspray ?paint(ed)?\b/, /\bvandal(ised|ized|ism)?\b/, /\bfly ?post(ing|ers?)\b/, /\btagg(ed|ing)\b/],
  street_light: [
    /\bstreet ?lights?\b/,
    /\blamp ?posts?\b/,
    /\bstreet ?lamps?\b/,
    /\blight(s)? (is |are )?(out|not working|flickering)\b/,
    /\blighting column\b/,
  ],
  bus_shelter: [/\bbus (shelter|stop)s?\b/, /\bshelter\b/, /\btimetable\b/],
  other: [],
};

/** Pairs that commonly overlap, so a disagreement is a suggestion rather than a mismatch. */
const RELATED: [CategoryId, CategoryId][] = [
  ["pothole", "road_pavement_damage"],
  ["litter", "fly_tipping"],
  ["vandalism", "bus_shelter"],
];

export function areRelated(a: string, b: string): boolean {
  return a === b || RELATED.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

const SEVERITY_TERMS: { pattern: RegExp; weight: number; feature: string }[] = [
  { pattern: /\b(dangerous|danger|hazard(ous)?|lethal|unsafe)\b/, weight: 0.25, feature: "Described as dangerous" },
  { pattern: /\b(injur(y|ed|ies)|fell|fallen|tripped|broke (my|his|her)|hurt|accident)\b/, weight: 0.35, feature: "Injury or accident reported" },
  { pattern: /\b(cyclists?|cycling|bikes?|motorbikes?|motorcycl\w*|scooters?)\b/, weight: 0.2, feature: "Risk to cyclists or riders" },
  { pattern: /\b(wheelchairs?|pushchairs?|buggy|buggies|prams?|elderly|blind|disabled|mobility)\b/, weight: 0.2, feature: "Risk to vulnerable pedestrians" },
  { pattern: /\b(schools?|children|child|kids|nursery)\b/, weight: 0.15, feature: "Near children or a school" },
  { pattern: /\b(tyres?|wheel|suspension|punctur\w*|damag(ed|ing) (my|the) car)\b/, weight: 0.15, feature: "Vehicle damage reported" },
  { pattern: /\b(deep|huge|massive|enormous|large)\b/, weight: 0.1, feature: "Described as large or deep" },
  { pattern: /\b(exposed|live) wires?\b|\bsparking\b|\belectric(al)? (shock|hazard)\b/, weight: 0.45, feature: "Electrical hazard" },
  { pattern: /\b(asbestos|needles?|syringes?|chemicals?|gas (bottles?|canisters?))\b/, weight: 0.4, feature: "Hazardous material" },
  { pattern: /\b(flood(ing|ed)?|burst|water leak)\b/, weight: 0.15, feature: "Flooding or water leak" },
  { pattern: /\b(blocking|blocked|obstruct(ing|ion|ed))\b/, weight: 0.1, feature: "Obstruction" },
  { pattern: /\b(urgent(ly)?|emergency|immediately|asap)\b/, weight: 0.1, feature: "Marked urgent by reporter" },
  { pattern: /\b(months|years|weeks) (now|ago)?\b|\bstill (not|hasn'?t)\b|\bagain\b/, weight: 0.05, feature: "Long-standing or recurring" },
];

const ABUSIVE = /\b(f+u+c+k+\w*|shit\w*|bastards?|wankers?|twats?|c+u+n+t+s?)\b/;
const TEST_SUBMISSION = /^\s*(test(ing)?|asdf\w*|qwerty|hello|ignore( this)?|dummy)\s*[.!]*\s*$/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const UK_PHONE = /(\+44\s?7\d{3}|\b07\d{3})\s?\d{3}\s?\d{3}\b/;

function normalise(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
}

export function categoryScores(text: string): Record<CategoryId, number> {
  const t = normalise(text);
  const scores = {} as Record<CategoryId, number>;
  for (const [cat, patterns] of Object.entries(CATEGORY_KEYWORDS) as [CategoryId, RegExp[]][]) {
    scores[cat] = patterns.reduce((n, p) => n + (p.test(t) ? 1 : 0), 0);
  }
  return scores;
}

function bestCategory(scores: Record<CategoryId, number>): { category: CategoryId | null; hits: number; runnerUp: number } {
  const ranked = (Object.entries(scores) as [CategoryId, number][]).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || top[1] === 0) return { category: null, hits: 0, runnerUp: 0 };
  return { category: top[0], hits: top[1], runnerUp: second?.[1] ?? 0 };
}

function isUnintelligible(text: string): boolean {
  const letters = text.replace(/[^a-z]/gi, "");
  if (letters.length < 4) return true;
  const vowels = letters.replace(/[^aeiou]/gi, "").length;
  return letters.length > 8 && vowels / letters.length < 0.12;
}

export function analyseText(input: TriageInput): TextAnalysis {
  const text = `${input.title}\n${input.detail}\n${input.customType ?? ""}`;
  const t = normalise(text);
  const flags: Flag[] = [];

  // Severity from wording.
  let severity = 0;
  const keyFeatures: string[] = [];
  for (const term of SEVERITY_TERMS) {
    if (term.pattern.test(t)) {
      severity += term.weight;
      keyFeatures.push(term.feature);
    }
  }
  severity = Math.min(1, Math.round(severity * 100) / 100);

  // Quality and moderation flags.
  const detailLetters = input.detail.replace(/[^a-z]/gi, "").length;
  if (detailLetters < 12 && input.title.replace(/[^a-z]/gi, "").length < 12) {
    flags.push({ code: "low_detail", label: "Very little detail provided", severity: "info", source: "baseline" });
  }
  if (EMAIL.test(text) || UK_PHONE.test(text)) {
    flags.push({
      code: "contains_personal_data",
      label: "Contains an email address or phone number - redact before sharing",
      severity: "warning",
      source: "baseline",
    });
  }
  if (ABUSIVE.test(t)) {
    // Swearing is common in genuine reports (and in descriptions of offensive graffiti), so this is a
    // moderation flag for anything shown publicly rather than a sign the report is not genuine.
    flags.push({ code: "abusive_language", label: "Contains offensive language - moderate before publishing", severity: "warning", source: "baseline" });
  }
  if (TEST_SUBMISSION.test(input.title) || TEST_SUBMISSION.test(input.detail)) {
    flags.push({ code: "test_submission", label: "Looks like a test or placeholder submission", severity: "warning", source: "baseline", dubious: true });
  } else if (isUnintelligible(`${input.title} ${input.detail}`)) {
    flags.push({ code: "unintelligible", label: "Text could not be understood", severity: "warning", source: "baseline", dubious: true });
  }
  const waste = input.answers.waste_types;
  if (/\b(asbestos|needles?|syringes?|chemicals?|gas bottles?)\b/.test(t) || (Array.isArray(waste) && waste.includes("hazardous"))) {
    flags.push({ code: "hazardous_material", label: "Possible hazardous material", severity: "critical", source: "baseline" });
  }

  // Category: start from the resident's choice and test it against the wording.
  const scores = categoryScores(text);
  const best = bestCategory(scores);
  const resident = input.residentCategory;
  const residentHits = scores[resident] ?? 0;
  let category: TextAnalysis["category"] = resident;
  let confidence: number;

  if (resident !== "other") {
    confidence = residentHits > 0 ? 0.95 : 0.8;
    if (best.category && best.category !== resident && best.hits >= 2 && residentHits === 0 && !areRelated(best.category, resident)) {
      confidence = 0.55;
      flags.push({
        code: "category_mismatch",
        label: `Description reads like ${CATEGORY_BY_ID[best.category].label.toLowerCase()}`,
        severity: "warning",
        source: "baseline",
      });
    }
  } else if (input.serviceName !== "Other") {
    // A specific sub-type was chosen (e.g. "Illegal parking"), so trust it.
    confidence = 0.8;
  } else if (best.category && best.hits >= 2 && best.hits > best.runnerUp) {
    category = best.category;
    confidence = Math.min(0.85, 0.6 + 0.1 * best.hits);
  } else if (best.category && best.hits === 1 && best.runnerUp === 0) {
    category = best.category;
    confidence = 0.55;
  } else {
    category = "tbc";
    confidence = 0.3;
    flags.push({ code: "needs_category", label: "Could not determine the type of problem", severity: "info", source: "baseline" });
  }

  const alternatives = (Object.entries(scores) as [CategoryId, number][])
    .filter(([cat, hits]) => hits >= 2 && cat !== category)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, hits]) => ({ category: cat, confidence: Math.min(0.8, 0.4 + 0.1 * hits) }));

  return {
    source: "baseline",
    model: "keyword-baseline-v1",
    category,
    categoryConfidence: confidence,
    alternatives,
    severity,
    keyFeatures,
    flags,
    analysedAt: new Date().toISOString(),
  };
}
