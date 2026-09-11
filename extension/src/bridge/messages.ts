import type { ReportOutcome } from "../score/buildReport";
import type { Report, ReportSummary } from "../score/report";


export interface HistoryListRequest {
  type: "verdict:history:list";
}

export interface HistorySummaryEntry extends ReportSummary {
  id: number;
  timestamp: number;
  title: string;
  thumbnailUrl: string | null;
  // the local hash, so the site can group repeat checks without knowing the product
  productKey: string | null;
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

export type HistoryExportFormat = "json" | "csv";

export interface HistoryExportRequest {
  type: "verdict:history:export";
  format: HistoryExportFormat;
}

export interface HistoryExportResponse {
  format: HistoryExportFormat;
  filename: string;
  content: string;
}

export interface ReportGetRequest {
  type: "verdict:report:get";
  id: number;
}

export interface ReportGetResponse {
  report: Report | null;
}

export interface AnalyzeRequest {
  type: "verdict:analyze";
  url: string;
}

export type AnalyzeResponse =
  | { status: "unsupported-domain" }
  | { status: "not-a-product-page" }
  | { status: "timed-out" }
  | ReportOutcome;

export type BridgeRequest =
  | HistoryListRequest
  | HistoryClearRequest
  | HistoryExportRequest
  | ReportGetRequest
  | AnalyzeRequest;
export type BridgeResponse =
  | HistoryListResponse
  | HistoryClearResponse
  | HistoryExportResponse
  | ReportGetResponse
  | AnalyzeResponse;

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "verdict:history:list":
    case "verdict:history:clear":
      return true;
    case "verdict:history:export":
      return record.format === "json" || record.format === "csv";
    case "verdict:report:get":
      return Number.isInteger(record.id);
    case "verdict:analyze":
      return typeof record.url === "string";
    default:
      return false;
  }
}
