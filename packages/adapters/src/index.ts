import { CodechefAdapter } from "./codechef";
import { CodeforcesAdapter } from "./codeforces";
import { LeetcodeAdapter } from "./leetcode";
import type { Platform, PlatformAdapter } from "./types";

export * from "./types";
export * from "./http";
export * from "./parse";
export { CodeforcesAdapter, CF_PARSER_VERSION } from "./codeforces";
export { LeetcodeAdapter, LC_PARSER_VERSION } from "./leetcode";
export { CodechefAdapter, CC_PARSER_VERSION, parseCodechefProfile } from "./codechef";

let singletons: Record<Platform, PlatformAdapter> | null = null;

/** Process-wide adapters so each source's rate limit and circuit breaker are shared. */
export function getAdapters(): Record<Platform, PlatformAdapter> {
  singletons ??= {
    codeforces: new CodeforcesAdapter(),
    leetcode: new LeetcodeAdapter(),
    codechef: new CodechefAdapter(),
  };
  return singletons;
}
