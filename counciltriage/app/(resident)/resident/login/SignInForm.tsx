"use client";

import { useActionState, useState } from "react";
import { buttonStyles, cx, inputStyles } from "@/components/ui";
import { residentSignIn, residentTrack, type SignInState } from "../../actions";

export function SignInForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "reference">("password");
  const [signInState, signIn, signingIn] = useActionState<SignInState, FormData>(residentSignIn, {});
  const [trackState, track, tracking] = useActionState<SignInState, FormData>(residentTrack, {});
  const state = mode === "password" ? signInState : trackState;

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 rounded-lg bg-scc-sand p-1 text-sm font-semibold" role="tablist">
        {(
          [
            ["password", "I have an account"],
            ["reference", "Use a reference number"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={cx("rounded-md px-3 py-2", mode === id ? "bg-white text-scc-navy shadow-sm" : "text-slate-600 hover:text-scc-navy")}
          >
            {label}
          </button>
        ))}
      </div>
      {state.error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-medium text-red-800">
          {state.error}
        </p>
      )}
      {mode === "password" ? (
        <form action={signIn} className="space-y-4" data-testid="resident-signin">
          <input type="hidden" name="next" value={next} />
          <label className="block">
            <span className="mb-1 block font-medium text-slate-900">Email address</span>
            <input name="email" type="email" required autoComplete="username" defaultValue={signInState.email} className={inputStyles} />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-900">Password</span>
            <input name="password" type="password" required autoComplete="current-password" className={inputStyles} />
          </label>
          <button className={cx(buttonStyles.primary, "w-full")} disabled={signingIn}>
            {signingIn ? "Signing in..." : "Sign in"}
          </button>
        </form>
      ) : (
        <form action={track} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <p className="text-sm text-slate-600">No account? Use the email you reported with and any reference number you were given.</p>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-900">Email address</span>
            <input name="email" type="email" required autoComplete="email" defaultValue={trackState.email} className={inputStyles} />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-900">Report reference</span>
            <input name="ref" required placeholder="For example SR000123" className={`${inputStyles} font-mono uppercase`} />
          </label>
          <button className={cx(buttonStyles.primary, "w-full")} disabled={tracking}>
            {tracking ? "Checking..." : "Show my reports"}
          </button>
        </form>
      )}
    </div>
  );
}
