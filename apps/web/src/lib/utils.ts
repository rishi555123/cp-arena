import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const TZ = "Asia/Kolkata";

export function formatIST(d: Date, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...opts }).format(d);
}

export function timeAgo(d: Date | null | undefined, now = Date.now()): string {
  if (!d) return "never";
  const s = Math.round((now - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function timeUntil(d: Date, now = Date.now()): string {
  const s = Math.round((d.getTime() - now) / 1000);
  if (s <= 0) return "started";
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (days > 0) return `in ${days}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

export const fmt = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
