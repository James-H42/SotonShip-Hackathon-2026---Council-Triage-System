import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageSkeleton, buttonStyles, cx } from "@/components/ui";
import { requireOfficer } from "@/lib/auth";
import { formatDate, formatDateTime, minutesToHm } from "@/lib/format";
import { listWorkOrders } from "@/lib/repo/workorders";

export const metadata: Metadata = { title: "Work orders" };

const TONE = { issued: "bg-violet-100 text-violet-800", completed: "bg-emerald-100 text-emerald-800", cancelled: "bg-slate-100 text-slate-500" };

async function WorkOrders() {
  await requireOfficer();
  await connection();
  const orders = listWorkOrders();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Work orders</h1>
          <p className="text-sm text-slate-600">Daily routes issued to contracted repair crews.</p>
        </div>
        <Link href="/council/routes" className={buttonStyles.primary}>
          Plan a new day
        </Link>
      </div>
      {orders.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">No work orders yet. Use the route planner to create one.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Order</th>
                <th className="px-4 py-2">Work date</th>
                <th className="px-4 py-2">Contractor</th>
                <th className="px-4 py-2">Jobs</th>
                <th className="px-4 py-2">Crews</th>
                <th className="px-4 py-2">Driving</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/council/work-orders/${o.id}`} className="font-mono font-semibold text-brand-700 hover:underline">
                      {o.ref}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{formatDate(o.scheduledFor)}</td>
                  <td className="px-4 py-2.5">{o.contractor ?? "-"}</td>
                  <td className="px-4 py-2.5 tabular-nums">{o.plan.totals.jobs}</td>
                  <td className="px-4 py-2.5 tabular-nums">{o.plan.crews.length}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {o.plan.totals.km} km · {minutesToHm(o.plan.totals.minutes)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cx("rounded px-2 py-0.5 text-xs font-semibold", TONE[o.status])}>{o.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{formatDateTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function WorkOrdersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkOrders />
    </Suspense>
  );
}
