import type { RulesSet } from "../extract/rulesLoader";
import { allowedDomains, parseProductUrl, SITES, type SiteDefinition } from "../extract/sites";
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

export type CanonicalProductUrl =
  | { status: "ok"; url: string }
  | { status: "unsupported-domain" }
  | { status: "not-a-product-page" };

// tabs open bare registry product pages
export function canonicalProductUrl(
  url: string,
  rules: RulesSet,
  sites: readonly SiteDefinition[] = SITES,
): CanonicalProductUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: "unsupported-domain" };
  }
  // a storefront reached over http is not the storefront
  if (parsed.protocol !== "https:" || parsed.port !== "" || parsed.username !== "" || parsed.password !== "") {
    return { status: "unsupported-domain" };
  }
  for (const document of Object.values(rules)) {
    const site = sites.find((candidate) => candidate.id === document.site);
    for (const locale of document.locales) {
      const entry = site?.locales[locale];
      if (site === undefined || entry === undefined || !isAllowedHostname(parsed.hostname, [entry.domain])) {
        continue;
      }
      const candidate = `https://${entry.host}${parsed.pathname}`;
      const page = parseProductUrl(candidate, sites);
      if (page === null || page.site !== site.id || page.locale !== locale) {
        return { status: "not-a-product-page" };
      }
      return { status: "ok", url: candidate };
    }
  }
  return { status: "unsupported-domain" };
}

async function handleAnalyze(
  url: string,
  rules: RulesSet,
  analyzeUrl: AnalyzeUrl,
): Promise<AnalyzeResponse> {
  const canonical = canonicalProductUrl(url, rules);
  if (canonical.status !== "ok") {
    return canonical;
  }
  return analyzeUrl(canonical.url);
}

export interface BridgeHandlerOptions {
  bundledRules: RulesSet;
  analyzeUrl: AnalyzeUrl;
  rateLimiter?: BridgeRateLimiter;
  origin?: string;
  trustOrigin?: (origin: string | undefined) => boolean;
}

export async function handleBridgeMessage(
  message: unknown,
  options: BridgeHandlerOptions,
): Promise<BridgeResponse | { error: string }> {
  if (!isBridgeRequest(message)) {
    return { error: "unrecognised message" };
  }
  // firefox ignores the manifest allowlist
  if (options.trustOrigin !== undefined && !options.trustOrigin(options.origin)) {
    return { error: "untrusted origin" };
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
      return handleAnalyze(request.url, options.bundledRules, options.analyzeUrl);
    }
  }
}
