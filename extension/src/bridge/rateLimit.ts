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
