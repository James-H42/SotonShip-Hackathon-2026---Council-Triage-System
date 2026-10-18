import type { ReactNode } from "react";
import { CategoryIcon, Icon, type IconDefinition } from "@/components/icons";
import { CATEGORY_BY_ID, categoryLabel, type CategoryId } from "@/lib/taxonomy";
import { STATUS_BY_ID, type ReportStatus } from "@/lib/statuses";
import type { Flag, PriorityBand } from "@/lib/triage/types";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const BAND_STYLE: Record<PriorityBand, { label: string; className: string; dot: string }> = {
  critical: { label: "Critical", className: "bg-critical-bg text-critical ring-critical/30", dot: "bg-[#d92d20]" },
  high: { label: "High", className: "bg-high-bg text-high ring-high/30", dot: "bg-[#f97316]" },
  medium: { label: "Medium", className: "bg-medium-bg text-medium ring-medium/30", dot: "bg-[#eab308]" },
  low: { label: "Low", className: "bg-low-bg text-low ring-low/30", dot: "bg-[#2e90fa]" },
  monitor: { label: "Monitor", className: "bg-monitor-bg text-monitor ring-monitor/30", dot: "bg-[#98a2b3]" },
};

/** Map pin and chart colours: chosen to stay distinguishable from each other on the map. */
export const BAND_HEX: Record<PriorityBand, string> = {
  critical: "#d92d20",
  high: "#f97316",
  medium: "#eab308",
  low: "#2e90fa",
  monitor: "#98a2b3",
};

const BAND_TEXT: Record<PriorityBand, string> = { critical: "#b42318", high: "#c4320a", medium: "#8a5300", low: "#175cd3", monitor: "#475467" };

export function PriorityBadge({ band, score }: { band: PriorityBand; score?: number }) {
  const s = BAND_STYLE[band] ?? BAND_STYLE.low;
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap", s.className)}>
      <span className={cx("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
      {score !== undefined && <span className="font-mono font-medium opacity-80">{Math.round(score)}</span>}
    </span>
  );
}

const TONE: Record<string, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-300",
  info: "bg-sky-50 text-sky-800 ring-sky-300",
  progress: "bg-violet-50 text-violet-800 ring-violet-300",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  muted: "bg-slate-50 text-slate-500 ring-slate-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-300",
};

export function StatusBadge({ status, audience = "resident" }: { status: ReportStatus; audience?: "resident" | "officer" }) {
  const def = STATUS_BY_ID[status];
  return (
    <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap", TONE[def?.tone ?? "neutral"])}>
      {audience === "officer" ? def?.officerLabel : def?.label}
    </span>
  );
}

export function CategoryTag({ category, service }: { category: string; service?: string | null }) {
  const showService = service && service !== "Other" && (CATEGORY_BY_ID[category as CategoryId]?.services.length ?? 0) > 1;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        category === "tbc" ? "bg-amber-100 text-amber-900" : "bg-brand-50 text-scc-navy",
      )}
    >
      <CategoryIcon category={category} className="opacity-70" />
      {categoryLabel(category)}
      {showService && <span className="font-normal opacity-70">· {service}</span>}
    </span>
  );
}

const FLAG_TONE = { info: "bg-slate-100 text-slate-700", warning: "bg-amber-100 text-amber-900", critical: "bg-red-100 text-red-800" } as const;

export function FlagChips({ flags, limit }: { flags: Flag[]; limit?: number }) {
  const shown = limit ? flags.slice(0, limit) : flags;
  if (!flags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((f, i) => (
        <span key={`${f.code}-${i}`} title={`${f.label} (${f.source})`} className={cx("rounded px-1.5 py-0.5 text-[11px] font-medium", FLAG_TONE[f.severity] ?? FLAG_TONE.info)}>
          {f.label}
        </span>
      ))}
      {limit && flags.length > limit && <span className="text-[11px] text-slate-500">+{flags.length - limit}</span>}
    </span>
  );
}

export function Card({ children, className, title, actions, icon }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; icon?: IconDefinition }) {
  return (
    <section className={cx("rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(0,25,60,0.06)]", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          {title && (
            <h2 className="flex items-center gap-2 text-sm font-semibold text-scc-navy">
              {icon && <Icon icon={icon} className="text-scc-blue" />}
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-slate-200/70", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export const buttonStyles = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-md bg-scc-navy px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-scc-navy-2 disabled:opacity-50 disabled:cursor-not-allowed",
  accent:
    "inline-flex items-center justify-center gap-2 rounded-md bg-scc-magenta px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-scc-magenta-dark disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-scc-navy shadow-sm hover:bg-slate-50 disabled:opacity-50",
  ghost: "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-scc-blue hover:bg-brand-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50",
  small:
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-scc-navy hover:bg-slate-50 disabled:opacity-50",
  smallPrimary:
    "inline-flex items-center justify-center gap-1.5 rounded-md bg-scc-navy px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-scc-navy-2 disabled:opacity-50",
};

/** Compact control for toolbars (does not stretch to full width). */
export const compactInputStyles =
  "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 shadow-sm focus:border-scc-blue focus:outline-none focus:ring-2 focus:ring-scc-blue/25";

export const inputStyles =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-scc-blue focus:outline-none focus:ring-2 focus:ring-scc-blue/25";

export function Stat({
  label,
  value,
  hint,
  tone,
  href,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: PriorityBand | "brand";
  href?: string;
  icon?: IconDefinition;
}) {
  const color = tone && tone !== "brand" ? BAND_TEXT[tone] : "#00193c";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        {icon && <Icon icon={icon} className="text-base" />}
      </div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </>
  );
  const cls = "block rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,25,60,0.06)]";
  return href ? (
    <a href={href} className={cx(cls, "transition hover:border-scc-blue hover:shadow-md")} style={{ color }}>
      {body}
    </a>
  ) : (
    <div className={cls} style={{ color }}>
      {body}
    </div>
  );
}
