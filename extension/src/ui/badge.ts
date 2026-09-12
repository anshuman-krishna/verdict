import type { ReportOutcome } from "../score/buildReport";
import { BAND_COLORS } from "../score/report";

export interface BadgeState {
  text: string;
  color: string;
}

const CLEARED: BadgeState = { text: "", color: "#00000000" };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// only status "ok" carries a report; every other outcome has nothing to show
export function badgeForOutcome(outcome: ReportOutcome | null): BadgeState {
  if (outcome === null || outcome.status !== "ok") {
    return CLEARED;
  }
  const { band, estimatedInorganicShare } = outcome.report;
  const percent = Math.round(clamp01(estimatedInorganicShare) * 100);
  return { text: `${percent}%`, color: BAND_COLORS[band] };
}
