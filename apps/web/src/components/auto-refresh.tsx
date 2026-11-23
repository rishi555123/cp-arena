"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-render the server page every few seconds while something is in progress (e.g. first sync). */
export function AutoRefresh({ active, ms = 3000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return null;
}
