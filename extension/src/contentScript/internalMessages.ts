import type { ReportOutcome } from "../score/buildReport";


export interface AnalysisResultMessage {
  type: "verdict:analysis-result";
  outcome: ReportOutcome | null;
}

export function isAnalysisResultMessage(value: unknown): value is AnalysisResultMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).type === "verdict:analysis-result"
  );
}
