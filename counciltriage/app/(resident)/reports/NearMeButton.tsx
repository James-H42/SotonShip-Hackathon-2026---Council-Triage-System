"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { buttonStyles } from "@/components/ui";

export function NearMeButton() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<"idle" | "locating" | "error">("idle");
  const active = params.has("near");

  if (active) {
    return (
      <button
        type="button"
        className={buttonStyles.secondary}
        onClick={() => {
          const next = new URLSearchParams(params);
          next.delete("near");
          next.delete("page");
          router.push(`/reports?${next.toString()}`);
        }}
      >
        Clear &quot;near me&quot;
      </button>
    );
  }
  return (
    <button
      type="button"
      className={buttonStyles.secondary}
      disabled={state === "locating"}
      onClick={() => {
        if (!navigator.geolocation) return setState("error");
        setState("locating");
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const next = new URLSearchParams(params);
            next.set("near", `${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`);
            next.set("radius", "800");
            next.delete("page");
            router.push(`/reports?${next.toString()}`);
            setState("idle");
          },
          () => setState("error"),
        );
      }}
    >
      {state === "locating" ? "Finding you..." : state === "error" ? "Location unavailable" : "Near me"}
    </button>
  );
}
