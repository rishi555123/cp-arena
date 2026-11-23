"use client";

import { RefreshCw } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui";
import { requestRefresh, type RefreshState } from "./actions";

/** `cooldownMin` is computed on the server so SSR and hydration agree. */
export function RefreshButton({ cooldownMin }: { cooldownMin: number }) {
  const [state, action, pending] = useActionState<RefreshState>(requestRefresh, null);
  const cooling = cooldownMin > 0 && !state;
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button type="submit" size="sm" variant="outline" disabled={pending || cooling} title={cooling ? "15-minute cooldown between refreshes" : undefined}>
        <RefreshCw className={pending ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden /> Refresh my data
      </Button>
      {state && (
        <span role="status" className={state.ok ? "text-xs text-up" : "text-xs text-muted-foreground"}>
          {state.message}
        </span>
      )}
      {cooling && <span className="text-xs text-muted-foreground">Available again in {cooldownMin} min</span>}
    </form>
  );
}
