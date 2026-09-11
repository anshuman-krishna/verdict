import type { RulesDocument } from "../extract/rules";
import { allowedDomains } from "../extract/sites";
import { summarizeReport } from "../score/report";
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

export function deriveAllowedHostnames(rules: RulesDocument): string[] {
  return allowedDomains(rules.site, rules.locales);
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
  bundledRules: RulesDocument;
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
    case "verdict:analyze": {
      return handleAnalyze(
        request.url,
        deriveAllowedHostnames(options.bundledRules),
        options.analyzeUrl,
      );
    }
  }
}
