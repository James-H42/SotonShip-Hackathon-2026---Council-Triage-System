/**
 * Push-mode integration: when LLM_TRIAGE_URL / VISION_API_URL are set, new
 * reports are sent to those services straight after submission. When they are
 * not set, reports stay `queued` and the external services can pull them from
 * GET /api/integrations/queue instead.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { CATEGORIES } from "../taxonomy";
import {
  applyImageAnalysis,
  applyTextAnalysis,
  getPhotos,
  getReport,
  getReportsByIds,
  setIntegrationStatus,
  toFixMyStreetRecord,
  type Report,
} from "../repo/reports";
import { parseImageAnalysis, parseTextAnalysis } from "./contracts";
import { enqueue } from "../ai/pipeline";
import { LLM_MODEL, OLLAMA_URL } from "../ai/ollama";
import { VISION_URL } from "../ai/vision";

export const TAXONOMY_SUMMARY = CATEGORIES.map((c) => ({ id: c.id, label: c.label, services: c.services }));

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.integrationApiKey ? { "x-integration-key": config.integrationApiKey } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.integrationTimeoutMs),
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

/** Request body sent to the LLM service. */
export function llmRequestFor(report: Report) {
  const nearby = getReportsByIds((report.triage?.duplicates ?? []).slice(0, 5).map((d) => d.id));
  return {
    report: toFixMyStreetRecord(report, getPhotos(report.id)),
    baseline: report.triage?.text ?? null,
    nearbyReports: nearby.map((r) => toFixMyStreetRecord(r)),
    taxonomy: TAXONOMY_SUMMARY,
  };
}

export async function sendToLlm(reportId: number): Promise<void> {
  if (!config.llmTriageUrl) return;
  const report = getReport(reportId);
  if (!report) return;
  setIntegrationStatus([reportId], "llm_status", "processing");
  try {
    const analysis = parseTextAnalysis(await postJson(config.llmTriageUrl, llmRequestFor(report)));
    applyTextAnalysis(reportId, analysis);
  } catch (err) {
    console.error(`[integrations] LLM triage failed for report ${reportId}:`, err);
    setIntegrationStatus([reportId], "llm_status", "failed");
  }
}

export async function sendToVision(reportId: number): Promise<void> {
  if (!config.visionUrl) return;
  const report = getReport(reportId);
  if (!report) return;
  setIntegrationStatus([reportId], "vision_status", "processing");
  try {
    for (const photo of getPhotos(reportId)) {
      const bytes = await fs.readFile(path.join(config.uploadDir, photo.fileName));
      const result = await postJson(config.visionUrl, {
        reportId,
        photoId: photo.id,
        residentCategory: report.residentCategory,
        mime: photo.mime,
        imageBase64: bytes.toString("base64"),
      });
      applyImageAnalysis(photo.id, parseImageAnalysis(result));
    }
  } catch (err) {
    console.error(`[integrations] Image analysis failed for report ${reportId}:`, err);
    setIntegrationStatus([reportId], "vision_status", "failed");
  }
}

/** True unless AI_PIPELINE=off: the built-in local pipeline (Ollama + ml/vision_service.py) triages new reports. */
export const localPipelineEnabled = () => process.env.AI_PIPELINE !== "off" && !config.llmTriageUrl && !config.visionUrl;

export async function dispatchNewReport(reportId: number) {
  if (localPipelineEnabled()) {
    await enqueue(reportId);
    return;
  }
  await Promise.allSettled([sendToVision(reportId), sendToLlm(reportId)]);
}

export function integrationStatus() {
  if (localPipelineEnabled()) {
    return { llm: { mode: "local", url: OLLAMA_URL, model: LLM_MODEL }, vision: { mode: "local", url: VISION_URL }, apiKeyConfigured: Boolean(config.integrationApiKey) };
  }
  return {
    llm: config.llmTriageUrl ? { mode: "push", url: config.llmTriageUrl } : { mode: "pull" },
    vision: config.visionUrl ? { mode: "push", url: config.visionUrl } : { mode: "pull" },
    apiKeyConfigured: Boolean(config.integrationApiKey),
  };
}
