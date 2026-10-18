/**
 * Client for the local image triage service (ml/vision_service.py): the team's
 * soton_triage_classifier.joblib over SigLIP2 image embeddings.
 */
import fs from "node:fs/promises";
import type { ImageAnalysis } from "../triage/types";
import type { CategoryId } from "../taxonomy";

export const VISION_URL = process.env.VISION_SERVICE_URL ?? "http://127.0.0.1:8765";

type VisionResponse = {
  predicted_category: string;
  category: CategoryId | null;
  confidence: number;
  uncertainty_score: number;
  severity: "low" | "medium" | "high";
  severity_score: number;
  probabilities: Record<string, number>;
  model: string;
};

export async function analysePhotoFile(filePath: string, mime = "image/jpeg", photoId?: number): Promise<ImageAnalysis> {
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), "photo");
  const res = await fetch(`${VISION_URL}/analyse`, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Vision service responded ${res.status}`);
  const v = (await res.json()) as VisionResponse;
  return {
    source: "vision",
    model: v.model,
    photoId,
    category: v.category,
    categoryConfidence: v.confidence,
    severity: v.severity_score,
    severityLabel: v.severity,
    uncertainty: v.uncertainty_score,
    predictedLabel: v.predicted_category,
    labels: Object.entries(v.probabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label, confidence]) => ({ label, confidence })),
    notes: `${v.predicted_category} (${Math.round(v.confidence * 100)}%), uncertainty ${v.uncertainty_score.toFixed(2)}, ${v.severity} severity`,
    analysedAt: new Date().toISOString(),
  };
}

export async function visionAvailable(): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(`${VISION_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return { ok: res.ok };
  } catch {
    return { ok: false, detail: "Start it with: npm run ai:vision" };
  }
}
