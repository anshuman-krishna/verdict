import type { Report } from "../score/report";
import type { RosetteInput } from "./rosette";

function evidenceValue(report: Report, signal: string): number {
  return report.evidence.find((row) => row.signal === signal)?.value ?? 0;
}

export function rosetteInputFromReport(report: Report): RosetteInput {
  return {
    burstShare: evidenceValue(report, "arrival timing"),
    duplicateShare: evidenceValue(report, "duplicate text"),
    estimatedInorganicShare: report.estimatedInorganicShare,
    band: report.band,
  };
}
