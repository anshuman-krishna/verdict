import type { Report } from "../score/report";
import type { RosetteInput } from "./rosette";

function evidenceValue(report: Report, signal: string): number {
  return report.evidence.find((row) => row.signal === signal)?.value ?? 0;
}

// panel.ts takes a Report and a RosetteInput as two separate arguments,
// since bootstrap.ts and buildReport.ts do not carry burstShare and
// duplicateShare on Report itself. This is the one place that reunites
// them, by name, off evidence.ts's fixed row set, so a caller mounting the
// panel from a ReportOutcome never has to know evidence.ts's row order.
export function rosetteInputFromReport(report: Report): RosetteInput {
  return {
    burstShare: evidenceValue(report, "arrival timing"),
    duplicateShare: evidenceValue(report, "duplicate text"),
    estimatedInorganicShare: report.estimatedInorganicShare,
    band: report.band,
  };
}
