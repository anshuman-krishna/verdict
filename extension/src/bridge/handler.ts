import type { RulesSet } from "../extract/rulesLoader";
import { allowedDomains } from "../extract/sites";
import { parseStoredReport, summarizeReport } from "../score/report";
import { reportAsText, reportDocumentJson, reportFilename } from "../score/reportDocument";
import {
  deleteAllHistory,
  exportHistoryAsCsv,
  exportHistoryAsJson,
  listHistory,
} from "../storage/history";
import type { BridgeRateLimiter } from "./rateLimit";
import {
  type AnalyzeResponse,
  type BridgeRequest,
  type BridgeResponse,
  isBridgeRequest,
} from "./messages";

// the union across every site this build carries rules for, so a storefront
// with no rules yet cannot be analysed through the bridge either
export function deriveAllowedHostnames(rules: RulesSet): string[] {
  return Object.values(rules).flatMap((document) =>
    allowedDomains(document.site, document.locales)
  );
}

function isAllowedHostname(hostname: string, allowed: readonly string[]): boolean {
  return allowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

type AnalyzeUrl = (url: string) => Promise<Exclude<AnalyzeResponse, { status: "unsupported-domain" }>>;

async function handleAnalyze(
  url: string,
  allowedHostnames: readonly string[],
  analyzeUrl: AnalyzeUrl,
): Promise<AnalyzeResponse> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: "unsupported-domain" };
  }
  // a storefront reached over http is not the storefront
  if (parsed.protocol !== "https:") {
    return { status: "unsupported-domain" };
  }
  if (!isAllowedHostname(parsed.hostname, allowedHostnames)) {
    return { status: "unsupported-domain" };
  }
  return analyzeUrl(url);
}

export interface BridgeHandlerOptions {
  bundledRules: RulesSet;
  analyzeUrl: AnalyzeUrl;
  rateLimiter?: BridgeRateLimiter;
  origin?: string;
}

export async function handleBridgeMessage(
  message: unknown,
  options: BridgeHandlerOptions,
): Promise<BridgeResponse | { error: string }> {
  if (!isBridgeRequest(message)) {
    return { error: "unrecognised message" };
  }
  if (options.rateLimiter !== undefined) {
    if (options.origin === undefined) {
      return { error: "unknown origin" };
    }
    if (!options.rateLimiter.allow(options.origin, message.type)) {
      return { error: "rate limited" };
    }
  }
  return handleRequest(message, options);
}

async function handleRequest(
  request: BridgeRequest,
  options: BridgeHandlerOptions,
): Promise<BridgeResponse> {
  switch (request.type) {
    case "verdict:history:list": {
      const entries = await listHistory();
      return {
        entries: entries.map((entry) => ({
          id: entry.id,
          timestamp: entry.timestamp,
          title: entry.title,
          thumbnailUrl: entry.thumbnailUrl,
          productKey: entry.productKey ?? null,
          ...summarizeReport(entry.report),
        })),
      };
    }
    case "verdict:history:clear": {
      await deleteAllHistory();
      return { ok: true };
    }
    case "verdict:history:export": {
      const json = request.format === "json";
      return {
        format: request.format,
        filename: `verdict-history-${new Date().toISOString().slice(0, 10)}.${request.format}`,
        content: json ? await exportHistoryAsJson() : await exportHistoryAsCsv(),
      };
    }
    case "verdict:report:get": {
      const entries = await listHistory();
      const entry = entries.find((candidate) => candidate.id === request.id);
      // the report only, never the url or the id of anything else
      return { report: entry === undefined ? null : parseStoredReport(entry.report) };
    }
    case "verdict:report:export": {
      const entries = await listHistory();
      const entry = entries.find((candidate) => candidate.id === request.id);
      const report = entry === undefined ? null : parseStoredReport(entry.report);
      if (entry === undefined || report === null) {
        // nothing to export is an empty document, never another entry's
        return { filename: "", content: "" };
      }
      const exportedAt = Date.now();
      return request.format === "json"
        ? {
          filename: reportFilename(report, "json"),
          content: reportDocumentJson(report, entry.title, exportedAt),
        }
        : {
          filename: reportFilename(report, "txt"),
          content: reportAsText(report, entry.title, exportedAt),
        };
    }
    case "verdict:analyze": {
      return handleAnalyze(
        request.url,
        deriveAllowedHostnames(options.bundledRules),
        options.analyzeUrl,
      );
    }
  }
}
