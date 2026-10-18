import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -65536;
PRAGMA mmap_size = 268435456;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS residents (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS officers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'officer',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  external_url TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  location_text TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  location_precision TEXT NOT NULL DEFAULT 'exact',
  ward TEXT,
  resident_category TEXT NOT NULL,
  service_name TEXT NOT NULL,
  custom_type TEXT,
  answers TEXT NOT NULL DEFAULT '{}',
  hazard_level TEXT,
  pothole_class TEXT,
  has_photo INTEGER NOT NULL DEFAULT 0,
  in_sample INTEGER NOT NULL DEFAULT 0,
  resident_id INTEGER REFERENCES residents(id),

  category TEXT NOT NULL,
  category_source TEXT NOT NULL,
  category_confidence REAL,
  suggested_category TEXT,
  priority_score REAL NOT NULL DEFAULT 0,
  priority_band TEXT NOT NULL DEFAULT 'low',
  response_target TEXT,
  due_at TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  dubious INTEGER NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '[]',
  triage TEXT NOT NULL DEFAULT '{}',
  triage_source TEXT NOT NULL DEFAULT 'pending',
  officer_category TEXT,
  priority_override REAL,
  moderation TEXT,
  llm_status TEXT NOT NULL DEFAULT 'queued',
  vision_status TEXT NOT NULL DEFAULT 'none',
  duplicate_of INTEGER REFERENCES reports(id),
  supporters INTEGER NOT NULL DEFAULT 0,
  work_order_id INTEGER,
  geo_context TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_reports_priority ON reports(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_reports_status_priority ON reports(status, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_reports_category_status ON reports(category, status);
CREATE INDEX IF NOT EXISTS idx_reports_ward ON reports(ward);
CREATE INDEX IF NOT EXISTS idx_reports_latlon ON reports(lat, lon);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_resident ON reports(resident_id);
CREATE INDEX IF NOT EXISTS idx_reports_llm_status ON reports(llm_status);
CREATE INDEX IF NOT EXISTS idx_reports_vision_status ON reports(vision_status);
CREATE INDEX IF NOT EXISTS idx_reports_review ON reports(needs_review, dubious);
CREATE INDEX IF NOT EXISTS idx_reports_duplicate_of ON reports(duplicate_of);

CREATE VIRTUAL TABLE IF NOT EXISTS reports_fts USING fts5(
  title, detail, location_text,
  content='reports', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS reports_ai AFTER INSERT ON reports BEGIN
  INSERT INTO reports_fts(rowid, title, detail, location_text) VALUES (new.id, new.title, new.detail, new.location_text);
END;
CREATE TRIGGER IF NOT EXISTS reports_ad AFTER DELETE ON reports BEGIN
  INSERT INTO reports_fts(reports_fts, rowid, title, detail, location_text) VALUES ('delete', old.id, old.title, old.detail, old.location_text);
END;
CREATE TRIGGER IF NOT EXISTS reports_au AFTER UPDATE OF title, detail, location_text ON reports BEGIN
  INSERT INTO reports_fts(reports_fts, rowid, title, detail, location_text) VALUES ('delete', old.id, old.title, old.detail, old.location_text);
  INSERT INTO reports_fts(rowid, title, detail, location_text) VALUES (new.id, new.title, new.detail, new.location_text);
END;

CREATE TABLE IF NOT EXISTS report_photos (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  bytes INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  analysis TEXT
);
CREATE INDEX IF NOT EXISTS idx_photos_report ON report_photos(report_id);

CREATE TABLE IF NOT EXISTS report_events (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT,
  message TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  actor_type TEXT NOT NULL,
  actor_name TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_report ON report_events(report_id, created_at);

CREATE TABLE IF NOT EXISTS report_links (
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  related_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  score REAL,
  distance_m REAL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (report_id, related_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_links_related ON report_links(related_id, kind);

CREATE TABLE IF NOT EXISTS report_supporters (
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  email_hash TEXT NOT NULL,
  resident_id INTEGER REFERENCES residents(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (report_id, email_hash)
);

CREATE TABLE IF NOT EXISTS triage_feedback (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  officer_id INTEGER REFERENCES officers(id),
  field TEXT NOT NULL,
  model_value TEXT,
  officer_value TEXT,
  model_source TEXT,
  snapshot TEXT
);

CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES officers(id),
  scheduled_for TEXT NOT NULL,
  contractor TEXT,
  contractor_email TEXT,
  status TEXT NOT NULL,
  plan TEXT NOT NULL,
  notes TEXT
);
`;

declare global {
  var __counciltriageDb: DatabaseSync | undefined;
}

/** Columns and indexes added after the first release; applied to existing databases on open. */
function migrate(db: DatabaseSync) {
  const columns = (db.prepare("PRAGMA table_xinfo(reports)").all() as { name: string }[]).map((c) => c.name);
  if (!columns.includes("is_open")) {
    // Open/closed as an indexable column: `status IN (...)` cannot use index order for ranking.
    db.exec(
      "ALTER TABLE reports ADD COLUMN is_open INTEGER GENERATED ALWAYS AS (status IN ('received','in_progress','repair_scheduled','monitoring')) VIRTUAL",
    );
  }
  // Where the report's point came from: the resident's map pin, or their photos' GPS data.
  if (!columns.includes("location_source")) db.exec("ALTER TABLE reports ADD COLUMN location_source TEXT NOT NULL DEFAULT 'map'");
  // Resident accounts are optional (reporting never needs one); a password enables sign-in.
  const residentCols = (db.prepare("PRAGMA table_xinfo(residents)").all() as { name: string }[]).map((c) => c.name);
  if (!residentCols.includes("password_hash")) db.exec("ALTER TABLE residents ADD COLUMN password_hash TEXT");
  db.exec(`
    -- Covering indexes so the dashboard never reads the wide triage JSON for ranking or counts.
    CREATE INDEX IF NOT EXISTS idx_reports_rank ON reports(is_open, priority_score DESC, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_reports_stats ON reports(is_open, priority_band, category, needs_review, dubious, source, due_at);
    CREATE INDEX IF NOT EXISTS idx_reports_open_geo ON reports(is_open, lat, lon);
    CREATE INDEX IF NOT EXISTS idx_reports_open_created ON reports(is_open, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_open_due ON reports(is_open, due_at);
    PRAGMA optimize;
  `);
}

export function openDatabase(file: string = config.dbPath): DatabaseSync {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Process-wide connection (kept on globalThis so dev hot reloads reuse it). */
export function db(): DatabaseSync {
  if (!globalThis.__counciltriageDb) globalThis.__counciltriageDb = openDatabase();
  return globalThis.__counciltriageDb;
}

/** Swap the shared connection (tests use an in-memory database). */
export function setDatabase(instance: DatabaseSync) {
  globalThis.__counciltriageDb = instance;
}

/** Run `fn` in a transaction. Nested calls join the outer transaction. */
export function transaction<T>(fn: () => T, database: DatabaseSync = db()): T {
  if (database.isTransaction) return fn();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (err) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw err;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
