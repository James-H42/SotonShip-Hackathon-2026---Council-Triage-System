"use client";

import {
  faArrowUpRightFromSquare,
  faClipboardList,
  faCodeMerge,
  faFlag,
  faGaugeHigh,
  faListCheck,
  faPlug,
  faRoute,
} from "@fortawesome/free-solid-svg-icons";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";

export type NavCounts = { open: number; needsReview: number; duplicates: number; dubious: number };

export function ConsoleNav({ counts }: { counts: NavCounts | null }) {
  const pathname = usePathname();
  const queue = useSearchParams().get("queue") ?? "";
  const onDashboard = pathname === "/council";
  const items = [
    { section: "Triage" },
    { href: "/council", label: "Priority queue", icon: faGaugeHigh, count: counts?.open, active: onDashboard && !queue },
    { href: "/council?queue=review", label: "Needs review", icon: faListCheck, count: counts?.needsReview, active: onDashboard && queue === "review", alert: true },
    { href: "/council?queue=duplicates", label: "Possible duplicates", icon: faCodeMerge, count: counts?.duplicates, active: onDashboard && queue === "duplicates" },
    { href: "/council?queue=dubious", label: "Flagged dubious", icon: faFlag, count: counts?.dubious, active: onDashboard && queue === "dubious" },
    { section: "Repairs" },
    { href: "/council/routes", label: "Route planner", icon: faRoute, active: pathname.startsWith("/council/routes") },
    { href: "/council/work-orders", label: "Work orders", icon: faClipboardList, active: pathname.startsWith("/council/work-orders") },
    { section: "System" },
    { href: "/council/integrations", label: "AI integrations", icon: faPlug, active: pathname.startsWith("/council/integrations") },
  ] as const;

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Console">
      {items.map((item, i) =>
        "section" in item ? (
          <p key={i} className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-widest text-white/40">
            {item.section}
          </p>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={cx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              item.active ? "bg-white text-scc-navy shadow" : "text-white/80 hover:bg-white/10 hover:text-white",
            )}
          >
            <Icon icon={item.icon} className={cx("w-4", item.active ? "text-scc-magenta" : "text-white/60")} />
            <span className="flex-1">{item.label}</span>
            {"count" in item && item.count !== undefined && (
              <span
                className={cx(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                  item.active ? "bg-scc-navy text-white" : "alert" in item && item.count > 0 ? "bg-scc-magenta text-white" : "bg-white/10 text-white/80",
                )}
              >
                {item.count.toLocaleString()}
              </span>
            )}
          </Link>
        ),
      )}
      <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-widest text-white/40">Public</p>
      <a href="/resident" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/60 hover:bg-white/10 hover:text-white">
        <Icon icon={faArrowUpRightFromSquare} className="w-4" /> Resident site
      </a>
    </nav>
  );
}
