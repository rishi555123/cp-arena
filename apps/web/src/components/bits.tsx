import { PLATFORM_LABEL, tierFor, type Platform } from "@cp-arena/scoring";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Badge, Unavailable } from "@/components/ui";
import type { PlatformCell } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** ▲/▼ icon + number — never colour alone. Positive = climbed. */
export function RankChange({ value, className, unit = "places" }: { value: number | null; className?: string; unit?: string }) {
  if (value == null) return <span className={cn("text-xs text-muted-foreground", className)}>new</span>;
  if (value === 0)
    return (
      <span className={cn("inline-flex items-center gap-0.5 text-xs text-muted-foreground", className)} aria-label="no change">
        <Minus className="size-3" aria-hidden />0
      </span>
    );
  const up = value > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-up" : "text-down", className)} aria-label={`${up ? "up" : "down"} ${Math.abs(value)} ${unit}`}>
      {up ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
      {Math.abs(value)}
    </span>
  );
}

const DIVISION_STYLE: Record<string, string> = {
  Diamond: "border-sky-400/60 text-sky-300 light:text-sky-700",
  Platinum: "border-teal-400/60 text-teal-300 light:text-teal-700",
  Gold: "border-amber-400/60 text-amber-300 light:text-amber-700",
  Silver: "border-slate-400/60 text-slate-300 light:text-slate-600",
  Bronze: "border-orange-400/60 text-orange-300 light:text-orange-800",
};

export function DivisionBadge({ division, rank }: { division: string; rank?: number }) {
  return (
    <Badge className={DIVISION_STYLE[division] ?? ""}>
      {division}
      {rank != null && <span className="ml-1 opacity-80">#{rank}</span>}
    </Badge>
  );
}

export function PlatformRating({ platform, cell }: { platform: Platform; cell?: PlatformCell }) {
  if (!cell) return <Unavailable why={`No ${PLATFORM_LABEL[platform]} account linked`} />;
  if (!cell.verified) return <Unavailable why={`${PLATFORM_LABEL[platform]} account not verified yet`} />;
  if (cell.rating == null) return <Unavailable why={`Unrated on ${PLATFORM_LABEL[platform]} (no rated contests yet)`} />;
  const tier = cell.tier ?? tierFor(platform, cell.rating);
  return (
    <span className="flex flex-col leading-tight">
      <span className="font-medium tabular-nums">{cell.rating}</span>
      {tier && <span className="text-[11px] text-muted-foreground">{tier}</span>}
    </span>
  );
}

/** Tiny server-rendered SVG sparkline — no client JS, cheap for 1,000 rows. */
export function Sparkline({ values, width = 80, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <Unavailable why="Not enough history yet" />;
  const min = Math.min(...values);
  const maxV = Math.max(...values);
  const span = maxV - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 1 - ((v - min) / span) * (height - 2)).toFixed(1)}`).join(" ");
  const delta = values[values.length - 1] - values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`30-day Power trend ${delta >= 0 ? "up" : "down"} ${Math.abs(delta).toFixed(0)} points`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className={delta >= 0 ? "text-up" : "text-down"} />
    </svg>
  );
}

export function Avatar({ name, image, size = 28 }: { name: string; image?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (image)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" width={size} height={size} className="shrink-0 rounded-full" />;
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold" style={{ width: size, height: size }}>
      {initials}
    </span>
  );
}
