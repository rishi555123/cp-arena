import type { Platform } from "./config";

export interface TierBand {
  label: string;
  min: number;
  /** hex colour used for chart bands; always paired with the label in UI */
  color: string;
}

// Ordered low → high.
export const TIER_BANDS: Record<Platform, TierBand[]> = {
  codeforces: [
    { label: "Newbie", min: 0, color: "#808080" },
    { label: "Pupil", min: 1200, color: "#008000" },
    { label: "Specialist", min: 1400, color: "#03a89e" },
    { label: "Expert", min: 1600, color: "#0000ff" },
    { label: "Candidate Master", min: 1900, color: "#aa00aa" },
    { label: "Master", min: 2100, color: "#ff8c00" },
    { label: "International Master", min: 2300, color: "#ff8c00" },
    { label: "Grandmaster", min: 2400, color: "#ff0000" },
    { label: "International Grandmaster", min: 2600, color: "#ff0000" },
    { label: "Legendary Grandmaster", min: 3000, color: "#aa0000" },
  ],
  codechef: [
    { label: "1★", min: 0, color: "#666666" },
    { label: "2★", min: 1400, color: "#1e7d22" },
    { label: "3★", min: 1600, color: "#3366cc" },
    { label: "4★", min: 1800, color: "#684273" },
    { label: "5★", min: 2000, color: "#ffbf00" },
    { label: "6★", min: 2200, color: "#ff7f00" },
    { label: "7★", min: 2500, color: "#d0011b" },
  ],
  // LeetCode badges are percentile-based (Knight ≈ top 25%, Guardian ≈ top 5%); these rating
  // cut-offs are approximations used only for chart shading. The badge from the API wins when present.
  leetcode: [
    { label: "No badge", min: 0, color: "#7a7a7a" },
    { label: "Knight", min: 1850, color: "#3d8bd9" },
    { label: "Guardian", min: 2150, color: "#c18f2c" },
  ],
};

export function tierFor(platform: Platform, rating: number | null | undefined): string | null {
  if (rating == null) return null;
  const bands = TIER_BANDS[platform];
  let label = bands[0].label;
  for (const b of bands) if (rating >= b.min) label = b.label;
  return label;
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  codeforces: "Codeforces",
  leetcode: "LeetCode",
  codechef: "CodeChef",
};
