import type { Platform } from "./types";

export type AdapterErrorKind =
  | "not_found" // handle doesn't exist / was renamed
  | "blocked" // Cloudflare challenge, 403, HTML where JSON expected
  | "rate_limited"
  | "circuit_open"
  | "parse" // page/JSON shape changed
  | "network"
  | "unavailable"; // 5xx or platform-reported failure

export class AdapterError extends Error {
  constructor(
    public readonly source: Platform,
    public readonly kind: AdapterErrorKind,
    message: string,
  ) {
    super(`[${source}] ${kind}: ${message}`);
    this.name = "AdapterError";
  }
}

export interface SourcePolicy {
  /** minimum gap between request starts — Codeforces requires 2000ms */
  minIntervalMs: number;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** consecutive failures before the breaker opens */
  breakerThreshold: number;
  breakerCooldownMs: number;
  timeoutMs: number;
}

export const DEFAULT_POLICIES: Record<Platform, SourcePolicy> = {
  codeforces: { minIntervalMs: 2000, maxRetries: 3, baseBackoffMs: 2000, maxBackoffMs: 30_000, breakerThreshold: 5, breakerCooldownMs: 10 * 60_000, timeoutMs: 30_000 },
  leetcode: { minIntervalMs: 1500, maxRetries: 2, baseBackoffMs: 3000, maxBackoffMs: 60_000, breakerThreshold: 4, breakerCooldownMs: 30 * 60_000, timeoutMs: 20_000 },
  codechef: { minIntervalMs: 3000, maxRetries: 2, baseBackoffMs: 3000, maxBackoffMs: 60_000, breakerThreshold: 4, breakerCooldownMs: 30 * 60_000, timeoutMs: 20_000 },
};

export interface HttpResponse {
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<HttpResponse>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function userAgent(): string {
  const contact = process.env.CONTACT_EMAIL || "admin@example.com";
  return `CPArena/0.1 (community leaderboard; +mailto:${contact})`;
}

/**
 * One client per source: a serialised rate-limited queue, jittered exponential backoff on
 * transient errors, and a circuit breaker so a dead source fails fast instead of piling up.
 * Keep a single instance per process (see `getClient`) so the rate limit is global.
 */
export class SourceClient {
  private nextSlot = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(
    public readonly source: Platform,
    public readonly policy: SourcePolicy = DEFAULT_POLICIES[source],
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  get breakerOpenUntil(): Date | null {
    return this.openUntil > Date.now() ? new Date(this.openUntil) : null;
  }

  /** Throttle → fetch → classify. `classify` may throw AdapterError to mark the response bad. */
  async request(url: string, init: RequestInit = {}, classify?: (res: HttpResponse) => void): Promise<HttpResponse> {
    if (this.openUntil > Date.now()) {
      throw new AdapterError(this.source, "circuit_open", `circuit open until ${new Date(this.openUntil).toISOString()}`);
    }
    let attempt = 0;
    for (;;) {
      try {
        const res = await this.throttled(() => this.fetchOnce(url, init));
        if (res.status === 429) throw new AdapterError(this.source, "rate_limited", `429 from ${url}`);
        if (res.status >= 500) throw new AdapterError(this.source, "unavailable", `${res.status} from ${url}`);
        classify?.(res);
        this.consecutiveFailures = 0;
        return res;
      } catch (err) {
        const e = toAdapterError(this.source, err);
        // A missing handle or a parse problem is not a source outage.
        if (e.kind === "not_found" || e.kind === "parse") throw e;
        const retryable = e.kind === "network" || e.kind === "unavailable" || e.kind === "rate_limited";
        if (retryable && attempt < this.policy.maxRetries) {
          attempt++;
          const cap = Math.min(this.policy.maxBackoffMs, this.policy.baseBackoffMs * 2 ** attempt);
          await sleep(Math.random() * cap); // full jitter
          continue;
        }
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.policy.breakerThreshold) {
          this.openUntil = Date.now() + this.policy.breakerCooldownMs;
        }
        throw e;
      }
    }
  }

  private async fetchOnce(url: string, init: RequestInit): Promise<HttpResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.policy.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: ctrl.signal,
        headers: { "User-Agent": userAgent(), Accept: "application/json, text/html;q=0.9", ...(init.headers ?? {}) },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = this.nextSlot - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextSlot = Date.now() + this.policy.minIntervalMs;
      return fn();
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

function toAdapterError(source: Platform, err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new AdapterError(source, "network", msg);
}

/** Small TTL cache so one sync doesn't refetch the same payload for several adapter methods. */
export class TtlCache<V> {
  private map = new Map<string, { at: number; value: Promise<V> }>();
  constructor(private ttlMs: number) {}
  get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.map.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = load();
    this.map.set(key, { at: Date.now(), value });
    value.catch(() => this.map.delete(key));
    return value;
  }
}
