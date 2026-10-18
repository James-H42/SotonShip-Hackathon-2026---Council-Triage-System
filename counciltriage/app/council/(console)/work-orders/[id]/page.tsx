import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { MapPanel } from "@/components/map/MapPanel";
import { Card, PageSkeleton, PriorityBadge, StatusBadge, buttonStyles } from "@/components/ui";
import { requireOfficer } from "@/lib/auth";
import { clockTime, formatDate, minutesToHm } from "@/lib/format";
import { getReportsByIds } from "@/lib/repo/reports";
import { getWorkOrder } from "@/lib/repo/workorders";
import type { PriorityBand } from "@/lib/triage/types";
import { cancelWorkOrderAction, completeJobAction } from "../../actions";

export const metadata: Metadata = { title: "Work order" };

const CREW_COLOURS = ["#0e7490", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#2563eb", "#9333ea", "#ca8a04"];

async function WorkOrderView({ params }: { params: Promise<{ id: string }> }) {
  await requireOfficer();
  const { id } = await params;
  const order = getWorkOrder(Number(id));
  if (!order) notFound();
  const reports = new Map(getReportsByIds(order.plan.crews.flatMap((c) => c.stops.map((s) => s.job.id))).map((r) => [r.id, r]));
  const date = formatDate(order.scheduledFor);
  const mailBody = encodeURIComponent(
    [
      `Work order ${order.ref} for ${date}`,
      "",
      ...order.plan.crews.flatMap((c) => [
        `Crew ${c.crew} (${c.stops.length} jobs, ${c.totalKm} km):`,
        ...c.stops.map((s, i) => `  ${i + 1}. ${s.job.ref} ${s.job.title} - ${s.job.lat.toFixed(5)},${s.job.lon.toFixed(5)}`),
        ...c.mapsUrls.map((u) => `  Route: ${u}`),
        "",
      ]),
      order.notes ? `Notes: ${order.notes}` : "",
    ].join("\n"),
  );

  return (
    <div className="space-y-5">
      <div className="no-print">
        <Link href="/council/work-orders" className="text-sm text-brand-700 hover:underline">
          All work orders
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Work order <span className="font-mono">{order.ref}</span>
          </h1>
          <p className="text-sm text-slate-600">
            {date} · {order.contractor ?? "Contractor not set"} · {order.plan.totals.jobs} jobs · {order.plan.crews.length} crews of 2 · {order.plan.totals.km} km ·
            status <strong>{order.status}</strong>
          </p>
          {order.notes && <p className="mt-1 text-sm text-slate-700">Notes: {order.notes}</p>}
        </div>
        <div className="no-print flex flex-wrap gap-2">
          {order.contractorEmail && (
            <a className={buttonStyles.primary} href={`mailto:${order.contractorEmail}?subject=${encodeURIComponent(`Work order ${order.ref} - ${date}`)}&body=${mailBody}`}>
              Email to contractor
            </a>
          )}
          <a className={buttonStyles.secondary} href={`/api/council/work-orders/${order.id}`} target="_blank" rel="noreferrer">
            JSON for contractor system
          </a>
          {order.status === "issued" && (
            <ActionForm action={cancelWorkOrderAction}>
              <input type="hidden" name="workOrderId" value={order.id} />
              <SubmitButton className={buttonStyles.danger}>Cancel order</SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>

      <div className="no-print">
        <MapPanel
          pins={order.plan.crews.flatMap((c) =>
            c.stops.map((s) => ({ id: s.job.id, ref: s.job.ref, lat: s.job.lat, lon: s.job.lon, category: s.job.category, priorityBand: s.job.priorityBand as PriorityBand, title: s.job.title, href: `/council/reports/${s.job.id}` })),
          )}
          routes={order.plan.crews.map((c) => ({ id: `crew-${c.crew}`, label: `Crew ${c.crew}`, colour: CREW_COLOURS[(c.crew - 1) % CREW_COLOURS.length], path: c.path, roadPath: c.roadPath }))}
          depot={order.plan.options.depot}
         
          caption="Crew routes in visiting order."
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {order.plan.crews.map((c) => (
          <Card key={c.crew} title={`Crew ${c.crew} · ${c.stops.length} jobs · ${c.totalKm} km · ${minutesToHm(c.totalMinutes)}`}>
            <ol className="space-y-3 text-sm">
              {c.stops.map((s, i) => {
                const r = reports.get(s.job.id);
                return (
                  <li key={s.job.id} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/council/reports/${s.job.id}`} className="font-medium text-slate-900 hover:underline">
                        {s.job.title}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {s.job.ref} · ~{clockTime(8, s.arriveMinute)} · {s.job.lat.toFixed(5)}, {s.job.lon.toFixed(5)}
                        {r?.locationText && ` · ${r.locationText}`}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <PriorityBadge band={s.job.priorityBand as PriorityBand} />
                        {r && <StatusBadge status={r.status} audience="officer" />}
                      </div>
                    </div>
                    {r?.status === "repair_scheduled" && r.workOrderId === order.id && (
                      <ActionForm action={completeJobAction} className="no-print">
                        <input type="hidden" name="workOrderId" value={order.id} />
                        <input type="hidden" name="reportId" value={s.job.id} />
                        <SubmitButton className={buttonStyles.small}>Mark fixed</SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ol>
            {c.mapsUrls.length > 0 && (
              <p className="mt-3 text-xs">
                {c.mapsUrls.map((u, i) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="mr-2 font-medium text-brand-700 underline">
                    Navigation{c.mapsUrls.length > 1 ? ` part ${i + 1}` : ""}
                  </a>
                ))}
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function WorkOrderPage({ params }: PageProps<"/council/work-orders/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkOrderView params={params} />
    </Suspense>
  );
}
