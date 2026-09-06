import type { ReportOutcome } from "../score/buildReport";
import type { ReportSummary } from "../score/report";

// SPEC.md section 11. every message the website can send the extension,
// and every response the extension can send back. the message names are
// a proposal, not a ratified spec line (SPEC.md only shows
// "verdict:history:list" as an example), kept in the same
// "verdict:noun:verb" shape.

export interface HistoryListRequest {
  type: "verdict:history:list";
}

export interface HistorySummaryEntry extends ReportSummary {
  id: number;
  timestamp: number;
  title: string;
  thumbnailUrl: string | null;
}

export interface HistoryListResponse {
  entries: HistorySummaryEntry[];
}

export interface HistoryClearRequest {
  type: "verdict:history:clear";
}

export interface HistoryClearResponse {
  ok: true;
}

export interface AnalyzeRequest {
  type: "verdict:analyze";
  url: string;
}

// bridge/analyzeViaTab.ts runs the same analysis amazon.content.ts always
// runs, in a background tab opened for this url, and relays its result
// back. "unsupported-domain" is decided before any tab opens, by the
// bridge's own domain check. "not-a-product-page" and "timed-out" are the
// two ways that relay itself can come back with nothing. Every other
// status is ReportOutcome, unchanged: whether this went through a real
// visit or this relay, SPEC.md non negotiable 5 (never confident on thin
// data) applies identically, since BUNDLED_AMAZON_RULES and
// score/model.ts's BUNDLED_MODEL are the same ones either path uses.
export type AnalyzeResponse =
  | { status: "unsupported-domain" }
  | { status: "not-a-product-page" }
  | { status: "timed-out" }
  | ReportOutcome;

export type BridgeRequest = HistoryListRequest | HistoryClearRequest | AnalyzeRequest;
export type BridgeResponse = HistoryListResponse | HistoryClearResponse | AnalyzeResponse;

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "verdict:history:list":
    case "verdict:history:clear":
      return true;
    case "verdict:analyze":
      return typeof record.url === "string";
    default:
      return false;
  }
}
