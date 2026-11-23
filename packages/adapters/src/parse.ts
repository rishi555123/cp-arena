import type { Platform } from "./types";

export type ParseResult = { ok: true; platform: Platform; handle: string } | { ok: false; error: string };

const HANDLE_RE = /^[A-Za-z0-9_.-]{2,40}$/;

// First path segments on leetcode.com that are not usernames.
const LC_RESERVED = new Set([
  "problems", "problemset", "contest", "discuss", "explore", "study-plan", "studyplan", "u", "accounts",
  "subscribe", "assessment", "interview", "store", "company", "tag", "list", "submissions", "profile", "progress", "graphql",
]);

const HOSTS: Record<Platform, string> = {
  leetcode: "leetcode.com",
  codeforces: "codeforces.com",
  codechef: "codechef.com",
};

/**
 * Accepts a full profile URL or a raw handle for `platform`.
 *   leetcode.com/u/{h}/, leetcode.com/{h}/, codeforces.com/profile/{h}, codechef.com/users/{h}
 * leetcode.cn is rejected with an explicit message.
 */
export function parseProfileInput(platform: Platform, input: string): ParseResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter a handle or profile URL." };

  // Handles may contain dots (e.g. CodeChef "gennady.korotkevich"), so only treat input as a URL
  // when it has a path or starts with a known host.
  const looksLikeUrl = raw.includes("/") || /^(https?:\/\/)?([a-z0-9-]+\.)*(leetcode|codeforces|codechef)\.(com|cn)\b/i.test(raw);
  if (!looksLikeUrl) {
    const handle = raw.replace(/^@/, "");
    return HANDLE_RE.test(handle) ? { ok: true, platform, handle } : { ok: false, error: `"${raw}" doesn't look like a valid handle.` };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That URL couldn't be parsed." };
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  if (host === "leetcode.cn" || host.endsWith(".leetcode.cn")) {
    return { ok: false, error: "LeetCode China (leetcode.cn) profiles aren't supported — please link your leetcode.com account." };
  }
  const detected = (Object.keys(HOSTS) as Platform[]).find((p) => host === HOSTS[p]);
  if (!detected) return { ok: false, error: `Unrecognised site "${host}". Expected ${HOSTS[platform]}.` };
  if (detected !== platform) return { ok: false, error: `That's a ${HOSTS[detected]} link — paste it in the ${detected} field.` };

  const seg = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let handle: string | undefined;
  if (platform === "leetcode") {
    if (seg[0] === "u") handle = seg[1];
    else if (seg.length >= 1 && !LC_RESERVED.has(seg[0].toLowerCase())) handle = seg[0];
  } else if (platform === "codeforces") {
    if (seg[0] === "profile") handle = seg[1];
  } else if (platform === "codechef") {
    if (seg[0] === "users") handle = seg[1];
  }
  if (!handle) {
    const shape = { leetcode: "leetcode.com/u/<handle>", codeforces: "codeforces.com/profile/<handle>", codechef: "codechef.com/users/<handle>" }[platform];
    return { ok: false, error: `Couldn't find a handle in that URL. Expected ${shape}.` };
  }
  return HANDLE_RE.test(handle) ? { ok: true, platform, handle } : { ok: false, error: `"${handle}" doesn't look like a valid handle.` };
}

/** Short, unambiguous token members paste into a public profile field. */
export function generateVerifyToken(rand: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
  return `CPA-${s}`;
}
