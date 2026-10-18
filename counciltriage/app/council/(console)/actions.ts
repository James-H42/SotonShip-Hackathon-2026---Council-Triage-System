"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireOfficer } from "@/lib/auth";
import {
  addNote,
  dismissDuplicate,
  getReportByRef,
  mergeReports,
  overrideCategory,
  overridePriority,
  retriage,
  setModeration,
  unmergeReport,
  updateStatus,
  type Actor,
} from "@/lib/repo/reports";
import { cancelWorkOrder, completeJob, createWorkOrder, planForSelectionOnRoads } from "@/lib/repo/workorders";
import { routeOptionsFrom } from "@/lib/route-params";
import { isReportStatus } from "@/lib/statuses";
import { isEffectiveCategoryId } from "@/lib/taxonomy";

export type ActionState = { ok?: boolean; message?: string; error?: string };

async function officerActor(): Promise<Actor> {
  const officer = await requireOfficer();
  return { type: "officer", name: officer.name, officerId: officer.officerId };
}

function reportId(formData: FormData): number {
  const id = Number(formData.get("reportId"));
  if (!Number.isInteger(id)) throw new Error("Missing report id");
  return id;
}

async function run(fn: (actor: Actor) => string | void): Promise<ActionState> {
  const actor = await officerActor();
  try {
    const message = fn(actor) ?? "Saved";
    refresh();
    return { ok: true, message };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function setStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((actor) => {
    const status = String(formData.get("status"));
    if (!isReportStatus(status) || status === "duplicate") throw new Error("Choose a valid status");
    const message = String(formData.get("message") ?? "").trim() || null;
    updateStatus(reportId(formData), status, { message, actor, isPublic: formData.get("public") !== "off" && formData.get("internal") !== "on" });
    return "Status updated";
  });
}

export async function overrideCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((actor) => {
    const value = String(formData.get("category") ?? "");
    if (value && !isEffectiveCategoryId(value)) throw new Error("Choose a valid category");
    overrideCategory(reportId(formData), value ? (value as never) : null, actor);
    return value ? "Category confirmed" : "Category override cleared";
  });
}

export async function overridePriorityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((actor) => {
    const raw = String(formData.get("score") ?? "").trim();
    if (formData.get("clear") === "1") {
      overridePriority(reportId(formData), null, actor);
      return "Priority override cleared";
    }
    const score = Number(raw);
    if (!raw || !Number.isFinite(score) || score < 0 || score > 100) throw new Error("Enter a priority between 0 and 100");
    overridePriority(reportId(formData), score, actor, String(formData.get("reason") ?? "").trim() || null);
    return "Priority updated";
  });
}

export async function moderationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((actor) => {
    const value = String(formData.get("moderation") ?? "");
    setModeration(reportId(formData), value === "dubious" || value === "genuine" ? value : null, actor);
    return value === "dubious" ? "Marked as dubious" : value === "genuine" ? "Marked as genuine" : "Moderation cleared";
  });
}

export async function noteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((actor) => {
    const note = String(formData.get("note") ?? "").trim();
    if (!note) throw new Error("Write a note first");
    addNote(reportId(formData), note.slice(0, 2000), actor, formData.get("public") === "on");
    return "Note added";
  });
}

export async function mergeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((actor) => {
    const duplicateId = Number(formData.get("duplicateId"));
    let canonicalId = Number(formData.get("canonicalId"));
    const canonicalRef = String(formData.get("canonicalRef") ?? "").trim();
    if (canonicalRef) {
      const target = getReportByRef(canonicalRef);
      if (!target) throw new Error(`No report with reference ${canonicalRef}`);
      canonicalId = target.id;
    }
    if (!Number.isInteger(duplicateId) || !Number.isInteger(canonicalId)) throw new Error("Choose the reports to merge");
    const merged = mergeReports(duplicateId, canonicalId, actor);
    return `Merged into ${merged.ref}`;
  });
}

export async function unmergeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((actor) => {
    const separated = unmergeReport(Number(formData.get("duplicateId")), actor);
    return `${separated.ref} is its own report again`;
  });
}

export async function dismissDuplicateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((actor) => {
    dismissDuplicate(reportId(formData), Number(formData.get("relatedId")), actor);
    return "Marked as not a duplicate";
  });
}

export async function retriageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(() => {
    retriage(reportId(formData));
    return "Triage recalculated";
  });
}

export async function bulkStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((actor) => {
    const ids = formData.getAll("ids").map(Number).filter(Number.isInteger);
    const status = String(formData.get("status"));
    if (!ids.length) throw new Error("Select at least one report");
    if (!isReportStatus(status) || status === "duplicate") throw new Error("Choose a status");
    const message = String(formData.get("message") ?? "").trim() || null;
    for (const id of ids) updateStatus(id, status, { message, actor, isPublic: true });
    return `Updated ${ids.length} report${ids.length > 1 ? "s" : ""}`;
  });
}

export async function issueWorkOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await officerActor();
  const params = Object.fromEntries(formData.entries());
  const wards = formData.getAll("wards").map(String);
  const { selection, options } = routeOptionsFrom({ ...params, wards });
  const plan = await planForSelectionOnRoads(selection, options);
  const scheduledFor = String(formData.get("scheduledFor") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)) return { error: "Choose the date the crews will work" };
  let id: number;
  try {
    id = createWorkOrder({
      plan,
      scheduledFor,
      contractor: String(formData.get("contractor") ?? "").trim() || null,
      contractorEmail: String(formData.get("contractorEmail") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      actor,
    }).id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the work order" };
  }
  redirect(`/council/work-orders/${id}`);
}

export async function completeJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((actor) => {
    completeJob(Number(formData.get("workOrderId")), reportId(formData), actor);
    return "Marked as fixed";
  });
}

export async function cancelWorkOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run((actor) => {
    cancelWorkOrder(Number(formData.get("workOrderId")), actor);
    return "Work order cancelled; unfinished jobs returned to the queue";
  });
}
