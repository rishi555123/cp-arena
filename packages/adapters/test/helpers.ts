import { readFileSync } from "node:fs";
import { SourceClient, type FetchLike, type HttpResponse, type Platform } from "../src";

export const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

export function respond(body: string, status = 200, contentType = "application/json"): HttpResponse {
  return { status, url: "", headers: { get: (h) => (h.toLowerCase() === "content-type" ? contentType : null) }, text: async () => body };
}

/** A client with no throttling/retries whose fetch is routed by `route`. */
export function fakeClient(source: Platform, route: (url: string, init?: RequestInit) => HttpResponse): SourceClient {
  const f: FetchLike = async (url, init) => route(url, init);
  return new SourceClient(source, { minIntervalMs: 0, maxRetries: 0, baseBackoffMs: 0, maxBackoffMs: 0, breakerThreshold: 3, breakerCooldownMs: 60_000, timeoutMs: 5000 }, f);
}
