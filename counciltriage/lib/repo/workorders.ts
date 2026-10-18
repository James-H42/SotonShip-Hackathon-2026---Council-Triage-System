/** Work orders: a day's planned routes issued to contracted repair crews. */
import type { SQLInputValue } from "node:sqlite";
import { db, nowIso, parseJson, transaction } from "../db";
import { withRoadRoutes } from "../road-routing";
import { planRoutes, type RouteJob, type RouteOptions, type RoutePlan } from "../routing";
import { BAND_ORDER } from "../triage/priority";
import { CATEGORY_BY_ID, isCategoryId } from "../taxonomy";
import { addEvent, getReport, updateStatus, type Actor, type Report } from "./reports";

type Row = Record<string, SQLInputValue>;

export type WorkOrderStatus = "issued" | "completed" | "cancelled";

export type WorkOrder = {
  id: number;
  ref: string;
  createdAt: string;
  createdBy: number | null;
  scheduledFor: string;
  contractor: string | null;
  contractorEmail: string | null;
  status: WorkOrderStatus;
  plan: RoutePlan;
  notes: string | null;
};

function toWorkOrder(r: Row): WorkOrder {
  return {
    id: Number(r.id),
    ref: String(r.ref),
    createdAt: String(r.created_at),
    createdBy: r.created_by === null ? null : Number(r.created_by),
    scheduledFor: String(r.scheduled_for),
    contractor: (r.contractor as string) ?? null,
    contractorEmail: (r.contractor_email as string) ?? null,
    status: r.status as WorkOrderStatus,
    plan: parseJson<RoutePlan>(r.plan, null as unknown as RoutePlan),
    notes: (r.notes as string) ?? null,
  };
}

export type JobSelection = {
  category?: string;
  minBand?: string;
  wards?: string[];
  limit?: number;
  includeReview?: boolean;
};

export function jobMinutesFor(report: Pick<Report, "category" | "answers">): number {
  const base = isCategoryId(report.category) ? CATEGORY_BY_ID[report.category].typicalJobMinutes : 30;
  if (report.category === "fly_tipping") {
    const amount = report.answers.waste_amount;
    if (amount === "lorry") return base + 40;
    if (amount === "van") return base + 20;
  }
  return base;
}

/** Open, unscheduled reports eligible for a crew visit, highest priority first. */
export function candidateJobs(sel: JobSelection): RouteJob[] {
  const clauses = ["status IN ('received', 'in_progress')", "work_order_id IS NULL", "dubious = 0", "duplicate_of IS NULL"];
  const params: SQLInputValue[] = [];
  if (!sel.includeReview) clauses.push("needs_review = 0");
  if (sel.category && sel.category !== "all") {
    clauses.push("category = ?");
    params.push(sel.category);
  }
  if (sel.minBand && BAND_ORDER.includes(sel.minBand as never)) {
    const allowed = BAND_ORDER.slice(0, BAND_ORDER.indexOf(sel.minBand as never) + 1).filter((b) => b !== "monitor");
    clauses.push(`priority_band IN (${allowed.map(() => "?").join(",")})`);
    params.push(...allowed);
  }
  if (sel.wards?.length) {
    clauses.push(`ward IN (${sel.wards.map(() => "?").join(",")})`);
    params.push(...sel.wards);
  }
  const rows = db()
    .prepare(
      `SELECT id, ref, title, category, lat, lon, priority_score, priority_band, answers FROM reports
       WHERE ${clauses.join(" AND ")} ORDER BY priority_score DESC, created_at ASC LIMIT ?`,
    )
    .all(...params, Math.min(sel.limit ?? 60, 300)) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    ref: String(r.ref),
    title: String(r.title),
    category: String(r.category),
    lat: Number(r.lat),
    lon: Number(r.lon),
    priorityScore: Number(r.priority_score),
    priorityBand: String(r.priority_band),
    jobMinutes: jobMinutesFor({ category: String(r.category) as Report["category"], answers: parseJson(r.answers, {}) }),
  }));
}

export function planForSelection(sel: JobSelection, options: Partial<RouteOptions>): RoutePlan {
  return planRoutes(candidateJobs(sel), options);
}

/** The same plan with each crew's route re-ordered and drawn on real roads (straight lines if routing fails). */
export async function planForSelectionOnRoads(sel: JobSelection, options: Partial<RouteOptions>): Promise<RoutePlan> {
  return withRoadRoutes(planForSelection(sel, options));
}

export function createWorkOrder(args: {
  plan: RoutePlan;
  scheduledFor: string;
  contractor?: string | null;
  contractorEmail?: string | null;
  notes?: string | null;
  actor: Actor;
}): WorkOrder {
  return transaction(() => {
    const database = db();
    const now = nowIso();
    const reportIds = args.plan.crews.flatMap((c) => c.stops.map((s) => s.job.id));
    if (!reportIds.length) throw new Error("The plan has no jobs");
    // Guard against two officers issuing the same jobs.
    const taken = database
      .prepare(`SELECT ref FROM reports WHERE id IN (${reportIds.map(() => "?").join(",")}) AND work_order_id IS NOT NULL`)
      .all(...reportIds) as Row[];
    if (taken.length) throw new Error(`Already on another work order: ${taken.map((t) => t.ref).join(", ")}`);

    const res = database
      .prepare(
        `INSERT INTO work_orders (ref, created_at, created_by, scheduled_for, contractor, contractor_email, status, plan, notes)
         VALUES ('pending', ?, ?, ?, ?, ?, 'issued', ?, ?)`,
      )
      .run(now, args.actor.officerId ?? null, args.scheduledFor, args.contractor ?? null, args.contractorEmail ?? null, JSON.stringify(args.plan), args.notes ?? null);
    const id = Number(res.lastInsertRowid);
    const ref = `WO${String(id).padStart(5, "0")}`;
    database.prepare("UPDATE work_orders SET ref = ? WHERE id = ?").run(ref, id);

    const date = new Date(args.scheduledFor).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    for (const crew of args.plan.crews) {
      for (const stop of crew.stops) {
        database.prepare("UPDATE reports SET work_order_id = ? WHERE id = ?").run(id, stop.job.id);
        updateStatus(stop.job.id, "repair_scheduled", {
          message: `A repair crew has been booked to attend on ${date}.`,
          actor: args.actor,
          isPublic: true,
        });
        addEvent(stop.job.id, {
          kind: "work_order",
          message: `Added to work order ${ref} (crew ${crew.crew}, stop ${crew.stops.indexOf(stop) + 1}).`,
          actor: args.actor,
          data: { workOrderId: id },
        });
      }
    }
    return getWorkOrder(id)!;
  });
}

export function getWorkOrder(id: number): WorkOrder | null {
  const row = db().prepare("SELECT * FROM work_orders WHERE id = ?").get(id) as Row | undefined;
  return row ? toWorkOrder(row) : null;
}

export function listWorkOrders(limit = 50): WorkOrder[] {
  return (db().prepare("SELECT * FROM work_orders ORDER BY scheduled_for DESC, id DESC LIMIT ?").all(limit) as Row[]).map(toWorkOrder);
}

/** Mark one job on a work order as done. */
export function completeJob(workOrderId: number, reportId: number, actor: Actor, message?: string) {
  return transaction(() => {
    const report = getReport(reportId);
    if (!report || report.workOrderId !== workOrderId) throw new Error("Report is not on this work order");
    updateStatus(reportId, "completed", { message: message || "The repair crew has fixed this problem.", actor, isPublic: true });
    const remaining = Number(
      (db().prepare("SELECT COUNT(*) AS n FROM reports WHERE work_order_id = ? AND status = 'repair_scheduled'").get(workOrderId) as Row).n,
    );
    if (remaining === 0) db().prepare("UPDATE work_orders SET status = 'completed' WHERE id = ?").run(workOrderId);
  });
}

/** Cancel a work order and release its unfinished jobs back to the queue. */
export function cancelWorkOrder(workOrderId: number, actor: Actor) {
  return transaction(() => {
    const rows = db().prepare("SELECT id FROM reports WHERE work_order_id = ? AND status = 'repair_scheduled'").all(workOrderId) as Row[];
    for (const r of rows) {
      db().prepare("UPDATE reports SET work_order_id = NULL WHERE id = ?").run(Number(r.id));
      updateStatus(Number(r.id), "in_progress", { message: "The planned visit has been rescheduled.", actor, isPublic: true });
    }
    db().prepare("UPDATE work_orders SET status = 'cancelled' WHERE id = ?").run(workOrderId);
  });
}
