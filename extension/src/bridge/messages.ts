import type { ReportSummary } from "../score/report";

// SPEC.md section 11. every message the website can send the extension,
// and every response the extension can send back. the message names are
// claude's proposal (SPEC.md only shows "verdict:history:list" as an
// example), kept in the same "verdict:noun:verb" shape.

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

// the extraction pipeline this would drive (fetching the url in the
// user's session, running it through the rules interpreter) waits on the
// same fixture corpus BUNDLED_AMAZON_RULES does, so this never fabricates
// a report. "unsupported-domain" is real: the bridge checked and rejected
// it. "not-implemented" is also real, not a placeholder pretending to be
// a result: the pipeline behind an allowed domain is not wired up yet.
export type AnalyzeResponse =
  | { status: "unsupported-domain" }
  | { status: "not-implemented" };

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
