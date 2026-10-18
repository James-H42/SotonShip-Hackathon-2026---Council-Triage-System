/**
 * Validation for results coming back from the external AI components.
 * Results from the network are untrusted, so they are normalised into the
 * internal TextAnalysis / ImageAnalysis types or rejected.
 */
import { isCategoryId, isEffectiveCategoryId } from "../taxonomy";
import type { Flag, ImageAnalysis, TextAnalysis } from "../triage/types";

export class ContractError extends Error {}

function num(v: unknown, name: string, { min = 0, max = 1 } = {}): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ContractError(`${name} must be a number`);
  return Math.max(min, Math.min(max, n));
}

function strList(v: unknown, max = 20): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ContractError("expected an array of strings");
  return v.filter((x) => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, max);
}

function flags(v: unknown, source: Flag["source"]): Flag[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ContractError("flags must be an array");
  return v.slice(0, 20).map((f) => {
    if (typeof f === "string") return { code: f.slice(0, 60), label: f.slice(0, 200), severity: "info", source };
    if (!f || typeof f !== "object" || typeof f.code !== "string") throw new ContractError("each flag needs a code");
    const severity = f.severity === "critical" || f.severity === "warning" ? f.severity : "info";
    return {
      code: String(f.code).slice(0, 60),
      label: String(f.label ?? f.code).slice(0, 200),
      severity,
      source,
      dubious: Boolean(f.dubious),
    } satisfies Flag;
  });
}

export function parseTextAnalysis(body: unknown): TextAnalysis {
  if (!body || typeof body !== "object") throw new ContractError("body must be an object");
  const b = body as Record<string, unknown>;
  if (!isEffectiveCategoryId(b.category)) throw new ContractError("category must be one of the taxonomy ids or 'tbc'");
  const alternatives = Array.isArray(b.alternatives)
    ? b.alternatives
        .filter((a): a is { category: string; confidence: unknown } => Boolean(a) && typeof a === "object" && isCategoryId((a as { category?: unknown }).category))
        .map((a) => ({ category: a.category as never, confidence: num(a.confidence, "alternatives.confidence") }))
    : undefined;
  return {
    source: "llm",
    model: typeof b.model === "string" ? b.model.slice(0, 80) : undefined,
    category: b.category,
    categoryConfidence: num(b.categoryConfidence ?? b.confidence, "categoryConfidence"),
    alternatives,
    severity: num(b.severity ?? 0, "severity"),
    keyFeatures: strList(b.keyFeatures),
    flags: flags(b.flags, "llm"),
    summary: typeof b.summary === "string" ? b.summary.slice(0, 1000) : undefined,
    duplicateOf: Array.isArray(b.duplicateOf) ? b.duplicateOf.map(Number).filter(Number.isInteger).slice(0, 20) : undefined,
    analysedAt: new Date().toISOString(),
  };
}

export function parseImageAnalysis(body: unknown): ImageAnalysis {
  if (!body || typeof body !== "object") throw new ContractError("body must be an object");
  const b = body as Record<string, unknown>;
  if (b.category !== null && b.category !== undefined && !isCategoryId(b.category)) {
    throw new ContractError("category must be a taxonomy id or null");
  }
  const labels = Array.isArray(b.labels)
    ? b.labels
        .filter((l): l is { label: string; confidence: unknown } => Boolean(l) && typeof (l as { label?: unknown }).label === "string")
        .slice(0, 20)
        .map((l) => ({ label: l.label.slice(0, 80), confidence: num(l.confidence, "labels.confidence") }))
    : undefined;
  return {
    source: "vision",
    model: typeof b.model === "string" ? b.model.slice(0, 80) : undefined,
    category: (b.category as ImageAnalysis["category"]) ?? null,
    categoryConfidence: num(b.categoryConfidence ?? b.confidence, "categoryConfidence"),
    severity: b.severity === null || b.severity === undefined ? null : num(b.severity, "severity"),
    labels,
    notes: typeof b.notes === "string" ? b.notes.slice(0, 1000) : undefined,
    analysedAt: new Date().toISOString(),
  };
}
