import type { BridgeRequest } from "./messages";


export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const MINUTE_MS = 60_000;

export const RATE_LIMITS: Record<BridgeRequest["type"], RateLimitRule> = {
  "verdict:history:list": { limit: 60, windowMs: MINUTE_MS },
  "verdict:history:clear": { limit: 6, windowMs: MINUTE_MS },
  "verdict:history:export": { limit: 12, windowMs: MINUTE_MS },
  "verdict:report:get": { limit: 60, windowMs: MINUTE_MS },
  "verdict:report:export": { limit: 12, windowMs: MINUTE_MS },
  "verdict:analyze": { limit: 6, windowMs: MINUTE_MS },
};

const MAX_TRACKED_ORIGINS = 32;

export type RateLimitSnapshot = Record<string, Partial<Record<BridgeRequest["type"], number[]>>>;

interface OriginState {
  lastSeen: number;
  hits: Map<string, number[]>;
}

export class BridgeRateLimiter {
  private readonly now: () => number;
  private readonly origins = new Map<string, OriginState>();

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  allow(origin: string, type: BridgeRequest["type"]): boolean {
    const rule = RATE_LIMITS[type];
    const now = this.now();
    const state = this.stateFor(origin, now);
    const cutoff = now - rule.windowMs;

    const recent = (state.hits.get(type) ?? []).filter((at) => at > cutoff);
    if (recent.length >= rule.limit) {
      state.hits.set(type, recent);
      return false;
    }
    recent.push(now);
    state.hits.set(type, recent);
    return true;
  }

  // only hits still inside their window, so what is kept is only what still counts
  snapshot(): RateLimitSnapshot {
    const now = this.now();
    const snapshot: RateLimitSnapshot = {};
    for (const [origin, state] of this.origins) {
      const hits: Partial<Record<BridgeRequest["type"], number[]>> = {};
      for (const [type, times] of state.hits) {
        const rule = RATE_LIMITS[type as BridgeRequest["type"]];
        const recent = times.filter((at) => at > now - rule.windowMs && at <= now);
        if (recent.length > 0) {
          hits[type as BridgeRequest["type"]] = recent;
        }
      }
      if (Object.keys(hits).length > 0) {
        snapshot[origin] = hits;
      }
    }
    return snapshot;
  }

  // the worker is stopped after thirty idle seconds, and a limit it forgets is no limit
  static restore(value: unknown, now: () => number = Date.now): BridgeRateLimiter {
    const limiter = new BridgeRateLimiter(now);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return limiter;
    }
    const at = now();
    const origins = Object.entries(value as Record<string, unknown>).slice(0, MAX_TRACKED_ORIGINS);
    for (const [origin, hits] of origins) {
      if (typeof hits !== "object" || hits === null || Array.isArray(hits)) {
        continue;
      }
      const state: OriginState = { lastSeen: at, hits: new Map() };
      for (const [type, times] of Object.entries(hits as Record<string, unknown>)) {
        if (!Object.hasOwn(RATE_LIMITS, type) || !Array.isArray(times)) {
          continue;
        }
        const rule = RATE_LIMITS[type as BridgeRequest["type"]];
        // a stamp far ahead of the clock would otherwise lock the site out indefinitely
        const recent = times
          .filter((time): time is number => typeof time === "number" && Number.isFinite(time))
          .filter((time) => time > at - rule.windowMs && time <= at + rule.windowMs)
          .slice(-rule.limit);
        if (recent.length > 0) {
          state.hits.set(type, recent);
        }
      }
      if (state.hits.size > 0) {
        limiter.origins.set(origin, state);
      }
    }
    return limiter;
  }

  private stateFor(origin: string, now: number): OriginState {
    const existing = this.origins.get(origin);
    if (existing !== undefined) {
      existing.lastSeen = now;
      return existing;
    }
    if (this.origins.size >= MAX_TRACKED_ORIGINS) {
      this.evictLeastRecentlySeen();
    }
    const state: OriginState = { lastSeen: now, hits: new Map() };
    this.origins.set(origin, state);
    return state;
  }

  private evictLeastRecentlySeen(): void {
    let oldestOrigin: string | null = null;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [origin, state] of this.origins) {
      if (state.lastSeen < oldestSeen) {
        oldestSeen = state.lastSeen;
        oldestOrigin = origin;
      }
    }
    if (oldestOrigin !== null) {
      this.origins.delete(oldestOrigin);
    }
  }
}
