/**
 * Contracts between the core system and the triage components.
 *
 * The LLM text service and the image model are developed separately. Each one
 * returns a `TextAnalysis` or `ImageAnalysis`. The core system combines them
 * with council policy rules into a `TriageRecord`, which drives categorisation,
 * the TBC review queue and priority ordering. `docs/INTEGRATION.md` describes
 * the HTTP shapes.
 */
import type { Answers, CategoryId, EffectiveCategoryId, HazardLevel } from "../taxonomy";

export type FlagCode =
  | "low_detail"
  | "contains_personal_data"
  | "abusive_language"
  | "unintelligible"
  | "test_submission"
  | "outside_area"
  | "approximate_location"
  | "category_mismatch"
  | "needs_category"
  | "possible_duplicate"
  | "hazardous_material"
  | "image_conflict"
  | "image_no_issue"
  | "officer_flagged";

export type FlagSeverity = "info" | "warning" | "critical";

export type Flag = {
  code: FlagCode | string;
  label: string;
  severity: FlagSeverity;
  source: "baseline" | "llm" | "vision" | "officer" | "system";
  /** Dubious flags push a report into review and reduce its priority. */
  dubious?: boolean;
};

/** Everything the analysers may look at. Mirrors the FixMyStreet record plus form answers. */
export type TriageInput = {
  id: number;
  title: string;
  detail: string;
  residentCategory: CategoryId;
  serviceName: string;
  customType?: string | null;
  answers: Answers;
  hazardLevel: HazardLevel | null;
  lat: number;
  lon: number;
  locationPrecision?: "exact" | "approximate";
  hasPhoto: boolean;
  createdAt: string;
  status: string;
  supporters: number;
  geoContext: GeoContext;
  /** Present when other reports have been merged into this one. */
  cluster?: ClusterStats;
};

export type GeoContext = {
  ward?: string | null;
  majorRoad?: { name: string; distanceMetres: number } | null;
  /** Optional enrichments the map/LLM teams can supply. */
  nearSchool?: boolean;
  nearBusStop?: boolean;
  roadClass?: "motorway" | "a_road" | "b_road" | "minor" | "unknown";
};

export type TextAnalysis = {
  source: "baseline" | "llm";
  model?: string;
  /** Category the analyser believes is correct. `tbc` = cannot tell. */
  category: EffectiveCategoryId;
  categoryConfidence: number;
  /** Other plausible categories, most likely first. */
  alternatives?: { category: CategoryId; confidence: number }[];
  /** 0 (trivial) to 1 (dangerous), from the wording of the report. */
  severity: number;
  keyFeatures: string[];
  flags: Flag[];
  summary?: string;
  /** Report ids the analyser believes describe the same problem. */
  duplicateOf?: number[];
  /** LLM extraction (civic_triage prompt): 1 cosmetic .. 5 immediate danger. */
  urgency?: number;
  /** Someone was actually hurt (not merely at risk). */
  injury?: boolean;
  /** Children, elderly, disabled, wheelchair/pushchair users etc. affected or at risk. */
  vulnerable?: boolean;
  secondaryCategories?: CategoryId[];
  /** The LLM's own category label (finer-grained than "other"). */
  llmLabel?: string;
  analysedAt: string;
};

export type ImageAnalysis = {
  source: "vision";
  model?: string;
  photoId?: number;
  /** Category detected in the image, or null when nothing relevant was found. */
  category: CategoryId | null;
  categoryConfidence: number;
  /** 0 to 1 visual severity (for example pothole size or volume of waste). */
  severity: number | null;
  labels?: { label: string; confidence: number }[];
  notes?: string;
  /** 0 = certain .. 1 = maximally uncertain (normalised entropy of the class probabilities). */
  uncertainty?: number;
  severityLabel?: "low" | "medium" | "high";
  /** Raw classifier label, e.g. broken_lights. */
  predictedLabel?: string;
  analysedAt: string;
};

/** Aggregates over a merged incident (the canonical report plus everything merged into it). */
export type ClusterStats = {
  reports: number;
  /** Reports in the cluster that describe an actual injury. */
  injuries: number;
  /** Injuries per week over the cluster's active window (min one week). */
  injuriesPerWeek: number;
  /** Reports mentioning vulnerable people affected or at risk. */
  vulnerable: number;
  /** Highest text severity (0..1) across members, and the best image severity. */
  maxTextSeverity: number;
  maxImageSeverity: number | null;
};

export type PriorityBand = "critical" | "high" | "medium" | "low" | "monitor";

export type PriorityFactor = { factor: string; points: number; detail?: string };

/** The Incident Risk Priority Score terms (all 0..1), kept for the audit trail. */
export type RiskTerms = {
  textSeverity: number;
  imageSeverity: number | null;
  severity: number;
  roadDistanceMetres: number | null;
  proximity: number;
  roadImpact: number;
  injuriesPerWeek: number;
  injuryTerm: number;
  vulnerableTerm: number;
  volumeTerm: number;
  weights: Record<string, number>;
  raw: number;
  override?: string;
};

export type PriorityResult = {
  score: number;
  band: PriorityBand;
  responseTarget: string;
  targetHours: number | null;
  factors: PriorityFactor[];
  risk?: RiskTerms;
};

export type CategoryDecision = {
  category: EffectiveCategoryId;
  confidence: number;
  source: "resident" | "baseline" | "llm" | "vision" | "officer";
  suggested: EffectiveCategoryId | null;
  reason: string;
};

export type DuplicateCandidate = { id: number; score: number; distanceMetres: number };

export type TriageRecord = {
  version: 1;
  text: TextAnalysis | null;
  images: ImageAnalysis[];
  category: CategoryDecision;
  priority: PriorityResult;
  duplicates: DuplicateCandidate[];
  flags: Flag[];
  needsReview: boolean;
  reviewReasons: string[];
  dubious: boolean;
  computedAt: string;
};
