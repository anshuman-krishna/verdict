import type { ReportOutcome } from "../score/buildReport";

// distinct from bridge/messages.ts's BridgeRequest/BridgeResponse, which
// are what the website is allowed to send in (validated against
// externally_connectable's scoped origins). This is purely internal, sent
// by amazon.content.ts to background.ts via browser.runtime.sendMessage
// (no target id, so it never crosses to another extension or the page),
// after every analysis, whether or not anything is currently listening
// for it. null means analyzePage itself returned null: not a product
// page, or a product page extraction could not find a title for.

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
