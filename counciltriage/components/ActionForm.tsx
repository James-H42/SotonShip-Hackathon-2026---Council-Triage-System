"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cx } from "@/components/ui";

type State = { ok?: boolean; message?: string; error?: string };

/** Form bound to a Server Action that reports success or failure inline. */
export function ActionForm({
  action,
  children,
  className,
  testId,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className} data-testid={testId}>
      {children}
      {state.error && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-700">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="mt-2 text-xs font-medium text-emerald-700">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function SubmitButton({ children, className, name, value }: { children: ReactNode; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cx(className, pending && "opacity-60")}>
      {pending ? "Saving..." : children}
    </button>
  );
}
