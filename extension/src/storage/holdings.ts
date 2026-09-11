import { countQueuedContributions, nextContributionDueAt } from "../graph/queue";
import { countHistory } from "./history";
import { countCachedProducts } from "./reviewsCache";

export interface Holdings {
  checks: number;
  cachedProducts: number;
  oldestCachedAt: number | null;
  queuedContributions: number;
  nextContributionAt: number | null;
}

// PRIVACY.md is a promise about what stays here, so the options page can show it
export async function readHoldings(): Promise<Holdings> {
  // counted, not listed, so opening the options page does not read every report
  const [checks, cached, queuedContributions, nextContributionAt] = await Promise.all([
    countHistory(),
    countCachedProducts(),
    countQueuedContributions(),
    nextContributionDueAt(),
  ]);
  return {
    checks,
    cachedProducts: cached.count,
    oldestCachedAt: cached.oldestCachedAt,
    queuedContributions,
    nextContributionAt,
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

const MS_PER_DAY = 86_400_000;

function daysSince(then: number, now: number): string {
  const days = Math.floor((now - then) / MS_PER_DAY);
  if (days < 1) {
    return "today";
  }
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function withinHours(then: number, now: number): string {
  const minutes = Math.round((then - now) / 60_000);
  if (minutes <= 0) {
    return "on the next send";
  }
  if (minutes < 60) {
    return `in about ${plural(minutes, "minute", "minutes")}`;
  }
  return `in about ${plural(Math.round(minutes / 60), "hour", "hours")}`;
}

export function checksLine(holdings: Holdings): string {
  return holdings.checks === 0
    ? "No checks saved."
    : `${plural(holdings.checks, "check", "checks")} saved.`;
}

export function cacheLine(holdings: Holdings, now: number): string {
  if (holdings.cachedProducts === 0) {
    return "No review pages held. They are kept for seven days after a deeper check.";
  }
  const oldest =
    holdings.oldestCachedAt === null ? "" : ` The oldest was read ${daysSince(holdings.oldestCachedAt, now)}.`;
  return `${plural(holdings.cachedProducts, "listing", "listings")} held, without review text.${oldest}`;
}

export function contributionLine(holdings: Holdings, now: number): string {
  if (holdings.queuedContributions === 0) {
    return "Nothing waiting to be sent.";
  }
  const when =
    holdings.nextContributionAt === null ? "" : ` The first leaves ${withinHours(holdings.nextContributionAt, now)}.`;
  return `${plural(holdings.queuedContributions, "hashed row", "hashed rows")} waiting to be sent.${when}`;
}
