"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { officerLogin, type LoginState } from "./actions";

const field =
  "block w-full rounded-lg border border-slate-600 bg-console-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-scc-focus focus:outline-none focus:ring-2 focus:ring-scc-focus/30";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "/council";
  const [state, action, pending] = useActionState<LoginState, FormData>(officerLogin, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-500/15 p-3 text-sm font-medium text-red-200">
          {state.error}
        </p>
      )}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-200">Council email</span>
        <input name="email" type="email" required autoComplete="username" defaultValue={state.email} className={field} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-200">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className={field} />
      </label>
      <button disabled={pending} className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-scc-navy hover:bg-scc-sand disabled:opacity-60">
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
