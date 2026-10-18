import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card, PageSkeleton, Stat } from "@/components/ui";
import { requireOfficer } from "@/lib/auth";
import { db } from "@/lib/db";
import { KEY_ROAD_LINES, WARD_SOURCE } from "@/lib/geo";
import { llmAvailable } from "@/lib/ai/ollama";
import { visionAvailable } from "@/lib/ai/vision";
import { integrationStatus, llmRequestFor } from "@/lib/integrations/dispatch";
import { dashboardStats, integrationQueue } from "@/lib/repo/reports";

export const metadata: Metadata = { title: "AI integrations" };

const ENDPOINTS = [
  ["GET", "/api/integrations/queue?stage=llm&limit=50&claim=1", "Pull reports awaiting LLM text triage (FixMyStreet schema + form answers + nearby reports)."],
  ["POST", "/api/integrations/llm-results", "Return LLM results: category, confidence, severity, key features, flags, duplicateOf, summary."],
  ["GET", "/api/integrations/queue?stage=vision&limit=50", "Pull photos awaiting the image model (with download URLs)."],
  ["POST", "/api/integrations/vision-results", "Return image results per photo: category, confidence, severity, labels."],
  ["GET", "/api/integrations/feedback?since=...", "Officer overrides for active learning (model value vs officer value + report snapshot)."],
  ["GET", "/api/integrations/export", "All reports as JSON Lines in the FixMyStreet scrape schema."],
  ["GET", "/api/council/map/pins?category=pothole", "GeoJSON pins for the interactive map (officer session). Same filters as the dashboard."],
  ["PATCH", "/api/council/reports/:id", "Officer actions from the map: status, category, priority, moderation, merge."],
  ["POST", "/api/council/routes", "Crew route plan as JSON (paths are lat/lon arrays for map polylines)."],
];

const LLM_RESPONSE_EXAMPLE = {
  reportId: 90000001,
  analysis: {
    model: "your-model-name",
    category: "pothole",
    categoryConfidence: 0.92,
    alternatives: [{ category: "road_pavement_damage", confidence: 0.3 }],
    severity: 0.8,
    keyFeatures: ["Risk to cyclists", "On a bus route"],
    flags: [{ code: "near_school", label: "Next to a primary school", severity: "info" }],
    duplicateOf: [],
    summary: "Deep pothole in the carriageway on a cycle route.",
  },
};

const VISION_RESPONSE_EXAMPLE = {
  photoId: 84,
  analysis: { model: "pothole-vit-v1", category: "pothole", categoryConfidence: 0.88, severity: 0.7, labels: [{ label: "pothole", confidence: 0.88 }] },
};

async function Integrations() {
  await requireOfficer();
  await connection();
  const status = integrationStatus();
  const [llm, vision] = await Promise.all([llmAvailable(), visionAvailable()]);
  const local = status.llm.mode === "local";
  const merged = Number((db().prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'duplicate'").get() as { n: number }).n);
  const photosDone = Number((db().prepare("SELECT COUNT(*) AS n FROM report_photos WHERE analysis IS NOT NULL").get() as { n: number }).n);
  const stats = dashboardStats();
  const feedback = Number((db().prepare("SELECT COUNT(*) AS n FROM triage_feedback").get() as { n: number }).n);
  const llmDone = Number((db().prepare("SELECT COUNT(*) AS n FROM reports WHERE llm_status = 'done'").get() as { n: number }).n);
  const open = Number((db().prepare("SELECT COUNT(*) AS n FROM reports WHERE is_open = 1").get() as { n: number }).n);
  const sample = integrationQueue("llm", 1, 90_000_000)[0] ?? integrationQueue("llm", 1, 0)[0];
  const samplePayload = sample ? { reportId: sample.id, ...llmRequestFor(sample), taxonomy: "(omitted)" } : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">AI integrations</h1>
        <p className="text-sm text-slate-600">
          New reports are triaged on this computer: a local LLM reads the description and the team&apos;s image model reads the photos. No report text or
          photo is sent to an external AI service. If a model is offline, the keyword baseline and council policy rules are used until it is back.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6" data-testid="ai-status">
        <Stat
          label="Local LLM"
          value={local ? (llm.ok ? "Online" : "Offline") : status.llm.mode === "push" ? "Push" : "Pull"}
          hint={local ? (llm.ok ? `${llm.model} via Ollama` : llm.detail) : "External service"}
        />
        <Stat label="LLM triaged" value={llmDone.toLocaleString()} hint={`${stats.llmQueued.toLocaleString()} of ${open.toLocaleString()} open waiting`} />
        <Stat
          label="Image model"
          value={local ? (vision.ok ? "Online" : "Offline") : status.vision.mode === "push" ? "Push" : "Pull"}
          hint={local ? (vision.ok ? "Team classifier + SigLIP2" : vision.detail) : "External service"}
        />
        <Stat label="Photos analysed" value={photosDone.toLocaleString()} hint={`${stats.visionQueued.toLocaleString()} waiting`} />
        <Stat label="Merged by AI or officers" value={merged.toLocaleString()} hint="Kept as separate reports" />
        <Stat label="Officer corrections" value={feedback.toLocaleString()} hint="Active-learning feedback" />
      </div>

      <Card title="How each report is triaged">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>
            <strong>Image model:</strong> category, confidence, uncertainty (0 = certain, 1 = maximally uncertain) and severity. Photos with uncertainty
            above 0.7 are treated as unclear.
          </li>
          <li>
            <strong>Local LLM:</strong> category, other problems mentioned, injury, vulnerable people affected, and urgency from 1 to 5.
          </li>
          <li>
            <strong>Review:</strong> a photo that matches neither the resident&apos;s category nor the LLM&apos;s is held for an officer.
          </li>
          <li>
            <strong>Merging:</strong> nearby reports of the same kind are checked by the LLM (&quot;the same physical problem?&quot;) and shown as one incident.
            Every report is kept.
          </li>
          <li>
            <strong>Priority:</strong> the Incident Risk Priority Score, combining text and image severity, distance to key roads, injuries per week,
            vulnerable people and the number of reports.
          </li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">Accuracy against the team&apos;s labelled test set: docs/EVALUATION.md (npm run ai:eval).</p>
      </Card>

      <Card title="External integration endpoints (optional)">
        <p className="mb-3 text-sm text-slate-600">
          External services authenticate with the <code className="rounded bg-slate-100 px-1">x-integration-key</code> header (INTEGRATION_API_KEY).{" "}
          {status.apiKeyConfigured ? "A key is configured." : "No key is configured, so these endpoints are open in development only."} Full contract:{" "}
          <code className="rounded bg-slate-100 px-1">docs/INTEGRATION.md</code>.
        </p>
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100">
            {ENDPOINTS.map(([method, path, desc]) => (
              <tr key={path}>
                <td className="py-2 pr-3 font-mono text-xs font-semibold text-violet-700">{method}</td>
                <td className="py-2 pr-3 font-mono text-xs">{path}</td>
                <td className="py-2 text-slate-600">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Sample LLM request (live, from the queue)">
          <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{samplePayload ? JSON.stringify(samplePayload, null, 2) : "Queue is empty."}</pre>
        </Card>
        <div className="space-y-5">
          <Card title="Expected LLM result">
            <pre className="overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(LLM_RESPONSE_EXAMPLE, null, 2)}</pre>
          </Card>
          <Card title="Expected image-model result">
            <pre className="overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(VISION_RESPONSE_EXAMPLE, null, 2)}</pre>
          </Card>
        </div>
      </div>

      <Card title="Map data">
        <p className="text-sm text-slate-600">
          Ward boundaries: <strong>{WARD_SOURCE}</strong> (ONS, <code>geo/wards.geojson</code>). Key roads for the priority score: the map team&apos;s overlay of
          motorway, trunk and primary roads (OpenStreetMap, <code>geo/key_roads.geojson</code>, <strong>{KEY_ROAD_LINES.toLocaleString()}</strong> road lines). See{" "}
          <code>geo/README.md</code>.
        </p>
      </Card>
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Integrations />
    </Suspense>
  );
}
