/** Report lifecycle shared by the resident tracker and the officer console. */

export type ReportStatus =
  | "received"
  | "in_progress"
  | "repair_scheduled"
  | "monitoring"
  | "completed"
  | "closed"
  | "duplicate";

export type StatusDefinition = {
  id: ReportStatus;
  /** Label residents see. */
  label: string;
  /** Label officers see. */
  officerLabel: string;
  /** Default public message added to the resident timeline when an officer sets this status. */
  publicMessage: string;
  open: boolean;
  tone: "neutral" | "info" | "progress" | "success" | "muted" | "warning";
};

export const STATUSES: StatusDefinition[] = [
  {
    id: "received",
    label: "Received",
    officerLabel: "New / awaiting action",
    publicMessage: "Your report has been received.",
    open: true,
    tone: "neutral",
  },
  {
    id: "in_progress",
    label: "Being processed",
    officerLabel: "Being processed",
    publicMessage: "A council officer is looking into this report.",
    open: true,
    tone: "info",
  },
  {
    id: "repair_scheduled",
    label: "Repair arranged",
    officerLabel: "Repair arranged",
    publicMessage: "A repair has been arranged.",
    open: true,
    tone: "progress",
  },
  {
    id: "monitoring",
    label: "Monitoring",
    officerLabel: "Monitoring only",
    publicMessage:
      "This is below the council's repair intervention level, so it will be monitored rather than repaired straight away.",
    open: true,
    tone: "warning",
  },
  {
    id: "completed",
    label: "Fixed",
    officerLabel: "Completed",
    publicMessage: "This problem has been fixed. Thank you for reporting it.",
    open: false,
    tone: "success",
  },
  {
    id: "closed",
    label: "Closed",
    officerLabel: "Closed (no further action)",
    publicMessage: "This report has been closed.",
    open: false,
    tone: "muted",
  },
  {
    id: "duplicate",
    label: "Merged with another report",
    officerLabel: "Duplicate (merged)",
    publicMessage: "This problem had already been reported, so your report has been merged with the existing one.",
    open: false,
    tone: "muted",
  },
];

export const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s])) as Record<
  ReportStatus,
  StatusDefinition
>;

export const OPEN_STATUSES = STATUSES.filter((s) => s.open).map((s) => s.id);

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === "string" && value in STATUS_BY_ID;
}

/** FixMyStreet only distinguishes open and closed. */
export function statusFromFixMyStreet(status: string): ReportStatus {
  return status === "closed" ? "completed" : "received";
}

export function statusToFixMyStreet(status: ReportStatus): "open" | "closed" {
  return STATUS_BY_ID[status].open ? "open" : "closed";
}
