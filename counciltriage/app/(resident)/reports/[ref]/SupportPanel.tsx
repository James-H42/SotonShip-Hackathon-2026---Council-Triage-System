"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonStyles, cx, inputStyles } from "@/components/ui";

export function SupportPanel({ reportRef, signedInEmail }: { reportRef: string; signedInEmail: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(signedInEmail ?? "");
  const [state, setState] = useState<{ status: "idle" | "sending" | "done" | "error"; message?: string }>({ status: "idle" });

  async function send() {
    setState({ status: "sending" });
    const res = await fetch(`/api/reports/${reportRef}/support`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    if (!res) return setState({ status: "error", message: "We could not reach the server." });
    const data = await res.json();
    if (!res.ok) return setState({ status: "error", message: data.error });
    setState({ status: "done", message: data.added ? "Thanks. Your support has been added and you will see updates in My reports." : "You have already added your support." });
    router.refresh();
  }

  if (state.status === "done") {
    return (
      <p className="rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-900" data-testid="support-done">
        {state.message}
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="font-semibold text-slate-900">Affected by this too?</p>
      <p className="text-sm text-slate-600">Add your support instead of making a new report. More reports raise the priority.</p>
      {!open ? (
        <button type="button" className={cx(buttonStyles.secondary, "mt-3")} onClick={() => (signedInEmail ? send() : setOpen(true))}>
          I&apos;m affected by this too
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="support-email">
            Email address
          </label>
          <input id="support-email" type="email" className={cx(inputStyles, "max-w-xs")} placeholder="Your email address" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="button" className={buttonStyles.primary} onClick={send} disabled={state.status === "sending"}>
            {state.status === "sending" ? "Adding..." : "Add my support"}
          </button>
        </div>
      )}
      {state.status === "error" && <p className="mt-2 text-sm text-red-700">{state.message}</p>}
    </div>
  );
}
