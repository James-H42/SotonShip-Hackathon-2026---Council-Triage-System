import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

/** Runtime configuration. Everything has a working local default; see `.env.example`. */
export const config = {
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, "data"),
  get dbPath() {
    return process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(this.dataDir, "counciltriage.db");
  },
  get uploadDir() {
    return path.join(this.dataDir, "uploads");
  },
  /** Folder holding reports.jsonl / reports_trimmed.jsonl and photos/ from the FixMyStreet scrape. */
  fixMyStreetDir:
    process.env.FMS_DATA_DIR ??
    [path.resolve(root, "../../FixMyStreet Scraper/fixmystreet_sample"), path.resolve(root, "../../Scripts/fixmystreet_sample")].find((d) => existsSync(d)) ??
    path.resolve(root, "../../FixMyStreet Scraper/fixmystreet_sample"),

  sessionSecret: process.env.SESSION_SECRET ?? "",

  /** Shared secret external AI services send in the `x-integration-key` header. */
  integrationApiKey: process.env.INTEGRATION_API_KEY ?? "",

  /** Optional HTTP endpoints for the externally developed models. Unset = use the built-in baseline. */
  llmTriageUrl: process.env.LLM_TRIAGE_URL ?? "",
  visionUrl: process.env.VISION_API_URL ?? "",
  integrationTimeoutMs: Number(process.env.INTEGRATION_TIMEOUT_MS ?? 15000),

  /** Reports whose category confidence falls below this go to the TBC review queue. */
  tbcConfidenceThreshold: Number(process.env.TBC_CONFIDENCE_THRESHOLD ?? 0.5),

  uploads: {
    maxFiles: 3,
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  },
};

export const RESIDENT_ID_OFFSET = 90_000_000;
