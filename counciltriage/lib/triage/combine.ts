/**
 * Combines text analysis, image analysis, duplicate candidates and officer
 * overrides into a single TriageRecord. Pure function: no database access.
 */
import { config } from "../config";
import { CATEGORY_BY_ID, type CategoryId, type EffectiveCategoryId } from "../taxonomy";
import { DUPLICATE_THRESHOLD } from "./duplicates";
import { bandForScore, computePriority, targetForBand } from "./priority";
import { areRelated } from "./text";
import type { CategoryDecision, DuplicateCandidate, Flag, ImageAnalysis, TextAnalysis, TriageInput, TriageRecord } from "./types";

/** Above this image uncertainty (0..1) a photo is treated as unclear rather than as evidence. */
export const IMAGE_UNCERTAIN = 0.7;

export type OfficerOverrides = {
  category?: EffectiveCategoryId | null;
  priorityScore?: number | null;
  flags?: Flag[];
};

function decideCategory(input: TriageInput, text: TextAnalysis | null, images: ImageAnalysis[], flags: Flag[], officerCategory?: EffectiveCategoryId | null): CategoryDecision {
  if (officerCategory) {
    return { category: officerCategory, confidence: 1, source: "officer", suggested: null, reason: "Set by a council officer" };
  }

  // Adjacent categories (pothole/road damage, litter/fly-tipping, vandalism/bus shelter): the
  // resident's explicit choice stands and the text model's view becomes a suggestion.
  if (text && text.category !== input.residentCategory && input.residentCategory !== "other" && text.category !== "tbc" && areRelated(text.category, input.residentCategory)) {
    text = { ...text, alternatives: [{ category: text.category as CategoryId, confidence: text.categoryConfidence }, ...(text.alternatives ?? [])], category: input.residentCategory, categoryConfidence: Math.max(text.categoryConfidence, 0.85) };
  }

  let decision: CategoryDecision = text
    ? {
        category: text.category,
        confidence: text.categoryConfidence,
        source: text.category === input.residentCategory ? "resident" : text.source,
        suggested: null,
        reason:
          text.category === input.residentCategory
            ? `Resident selected ${CATEGORY_BY_ID[input.residentCategory].label}`
            : `Text analysis (${text.source}) suggests a different category`,
      }
    : { category: input.residentCategory, confidence: 0.7, source: "resident", suggested: null, reason: "Resident selection" };

  // The image model can confirm, recategorise or contradict.
  const image = images
    .filter((i) => i.category)
    .sort((a, b) => (a.uncertainty ?? 1 - a.categoryConfidence) - (b.uncertainty ?? 1 - b.categoryConfidence))[0];
  if (image?.category) {
    const uncertainty = image.uncertainty ?? 1 - image.categoryConfidence;
    const imageLabel = CATEGORY_BY_ID[image.category].label.toLowerCase();
    // "Other" carries no information, so it cannot conflict with a photo.
    const residentInformative = input.residentCategory !== "other";
    const matchesResident = !residentInformative || areRelated(image.category, input.residentCategory);
    const matchesText = text !== null && text.category !== "tbc" && text.category !== "other" && areRelated(image.category, text.category);
    const matchesDecision = decision.category !== "tbc" && areRelated(image.category, decision.category);
    if (uncertainty > IMAGE_UNCERTAIN) {
      flags.push({ code: "image_unclear", label: `Photo is unclear to the image model (uncertainty ${uncertainty.toFixed(2)})`, severity: "info", source: "vision" });
      if (!matchesDecision) decision = { ...decision, suggested: image.category };
    } else if (image.category === decision.category) {
      decision = { ...decision, confidence: Math.max(decision.confidence, image.categoryConfidence), reason: `${decision.reason}; confirmed by image` };
    } else if (!matchesResident && !matchesText && !matchesDecision) {
      // The photo agrees with neither the resident nor the LLM: an officer must confirm before the report is accepted.
      flags.push({
        code: "image_conflict",
        label: `Photo looks like ${imageLabel}, which does not match the report`,
        severity: "warning",
        source: "vision",
      });
      decision = { ...decision, suggested: image.category };
    } else if (decision.category === "other" || decision.category === "tbc" || decision.confidence < 0.6) {
      decision = {
        category: image.category,
        confidence: Math.max(image.categoryConfidence * (1 - uncertainty), decision.confidence),
        source: "vision",
        suggested: null,
        reason: `Image model identified ${CATEGORY_BY_ID[image.category].label}`,
      };
    } else if (image.category !== decision.category) {
      decision = { ...decision, suggested: image.category, reason: `${decision.reason}; photo is consistent (${imageLabel})` };
    }
  }

  // Text vs resident: an informative resident choice the LLM clearly disagrees with needs a human look.
  if (
    text?.source === "llm" &&
    input.residentCategory !== "other" &&
    text.category !== "other" &&
    text.category !== "tbc" &&
    !areRelated(text.category, input.residentCategory)
  ) {
    flags.push({
      code: "category_mismatch",
      label: `Resident chose ${CATEGORY_BY_ID[input.residentCategory].label.toLowerCase()} but the description reads as ${CATEGORY_BY_ID[text.category].label.toLowerCase()}`,
      severity: "warning",
      source: "llm",
    });
  }

  if (decision.suggested === null && text) {
    if (text.category !== decision.category && text.category !== "tbc") {
      decision = { ...decision, suggested: text.category };
    } else {
      const alt = text.alternatives?.find((a) => a.category !== decision.category);
      if (alt) decision = { ...decision, suggested: alt.category };
    }
  }

  if (decision.confidence < config.tbcConfidenceThreshold && decision.category !== "tbc") {
    decision = { ...decision, suggested: decision.category, category: "tbc", reason: `${decision.reason}; confidence too low` };
  }
  return decision;
}

export function buildTriageRecord(args: {
  input: TriageInput;
  text: TextAnalysis | null;
  images: ImageAnalysis[];
  duplicates: DuplicateCandidate[];
  overrides?: OfficerOverrides;
  now?: Date;
}): TriageRecord {
  const { input, text, images, duplicates, overrides } = args;
  const flags: Flag[] = [...(text?.flags ?? []), ...(overrides?.flags ?? [])];
  if (!input.geoContext.ward) {
    flags.push({ code: "outside_area", label: "Location is outside the Southampton City Council area", severity: "warning", source: "system", dubious: true });
  }

  if (input.locationPrecision === "approximate") {
    flags.push({ code: "approximate_location", label: "Resident could not pinpoint the location", severity: "warning", source: "system" });
  }

  const category = decideCategory(input, text, images, flags, overrides?.category);

  const strongDuplicates = duplicates.filter((d) => d.score >= DUPLICATE_THRESHOLD);
  if (strongDuplicates.length) {
    flags.push({
      code: "possible_duplicate",
      label: `Possible duplicate of ${strongDuplicates.length} nearby report${strongDuplicates.length > 1 ? "s" : ""}`,
      severity: "info",
      source: text?.source === "llm" && text.duplicateOf?.length ? "llm" : "baseline",
    });
  }

  let priority = computePriority({ input, category: category.category, text, images, flags, now: args.now });
  if (overrides?.priorityScore !== undefined && overrides.priorityScore !== null) {
    const score = Math.max(0, Math.min(100, Math.round(overrides.priorityScore)));
    const band = bandForScore(score);
    priority = {
      score,
      band,
      responseTarget: targetForBand(band).label,
      targetHours: targetForBand(band).hours,
      factors: [...priority.factors, { factor: "Officer override", points: score - priority.score, detail: `Set to ${score}` }],
    };
  }

  const dubious = flags.some((f) => f.dubious);
  const reviewReasons: string[] = [];
  if (category.category === "tbc") reviewReasons.push("Category to be confirmed");
  if (dubious) reviewReasons.push("Possibly dubious report");
  for (const f of flags) {
    if (["category_mismatch", "image_conflict", "hazardous_material", "approximate_location", "manipulation_attempt"].includes(f.code)) reviewReasons.push(f.label);
  }
  if (overrides?.category) {
    // An officer has already confirmed the category; only moderation flags keep it in review.
    reviewReasons.splice(0, reviewReasons.length, ...reviewReasons.filter((r) => r === "Possibly dubious report"));
  }

  return {
    version: 1,
    text,
    images,
    category,
    priority,
    duplicates,
    flags,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    dubious,
    computedAt: (args.now ?? new Date()).toISOString(),
  };
}
