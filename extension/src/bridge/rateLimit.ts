import type { BridgeRequest } from "./messages";

// PRIVACY.md section 7. per origin so a developer hammering localhost cannot starve the real site.
// the three types do not share a budget: verdict:analyze is the only one that leaves the machine

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const MINUTE_MS = 60_000;

export const RATE_LIMITS: Record<BridgeRequest["type"], RateLimitRule> = {
  // a local IndexedDB read, cheap, and the history page may legitimately
  // refresh it as the user navigates
  "verdict:history:list": { limit: 60, windowMs: MINUTE_MS },
  // destructive and never something a person does twice in a row by
  // intent, so this is low enough that a loop stands out
  "verdict:history:clear": { limit: 6, windowMs: MINUTE_MS },
  // reads the whole history and serialises it: more than a list, still local
  "verdict:history:export": { limit: 12, windowMs: MINUTE_MS },
  // a tab open plus a storefront fetch each time
  "verdict:analyze": { limit: 6, windowMs: MINUTE_MS },
};

// every localhost port is a separate origin, so the map needs a bound. dropping the oldest at worst
// forgives someone their earlier requests rather than locking anybody out
const MAX_TRACKED_ORIGINS = 32;

interface OriginState {
  lastSeen: number;
  // one timestamp array per message type, newest last
  hits: Map<string, number[]>;
}

export class BridgeRateLimiter {
  private readonly now: () => number;
  private readonly origins = new Map<string, OriginState>();

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  // consumes an allowance when it returns true, and consumes nothing when
  // it returns false, so a rejected caller cannot push its own window out.
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
