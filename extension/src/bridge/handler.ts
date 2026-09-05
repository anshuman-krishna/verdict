import type { RulesDocument } from "../extract/rules";
import { summarizeReport } from "../score/report";
import { deleteAllHistory, listHistory } from "../storage/history";
import {
  type AnalyzeResponse,
  type BridgeRequest,
  type BridgeResponse,
  isBridgeRequest,
} from "./messages";

// SPEC.md section 9's site/locale pair for the bundled rules doubles as
// the supported storefront domain list: "amazon" + "co.uk" is
// amazon.co.uk. Deriving it from the rules document rather than a second
// hardcoded list means the two can never quietly drift apart.
export function deriveAllowedHostnames(rules: RulesDocument): string[] {
  return rules.locales.map((locale) => `${rules.site}.${locale}`);
}

function isAllowedHostname(hostname: string, allowed: readonly string[]): boolean {
  return allowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

async function handleAnalyze(url: string, allowedHostnames: readonly string[]): Promise<AnalyzeResponse> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { status: "unsupported-domain" };
  }
  if (!isAllowedHostname(hostname, allowedHostnames)) {
    return { status: "unsupported-domain" };
  }
  // CLAUDE.md non negotiable 1: no page url or product identifier the
  // server can read. this domain check runs before anything else so an
  // unsupported url is rejected before an interpreter, a fetch, or a
  // model ever sees it. the pipeline behind an allowed domain (extract,
  // score, combine) is not wired up yet, see AnalyzeResponse.
  return { status: "not-implemented" };
}

export interface BridgeHandlerOptions {
  bundledRules: RulesDocument;
}

// never accepts a message that is not one of the shapes messages.ts
// declares, and never throws: an unrecognised or malformed message is
// rejected rather than passed through to storage or a fetch.
export async function handleBridgeMessage(
  message: unknown,
  options: BridgeHandlerOptions,
): Promise<BridgeResponse | { error: string }> {
  if (!isBridgeRequest(message)) {
    return { error: "unrecognised message" };
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
    case "verdict:analyze": {
      return handleAnalyze(request.url, deriveAllowedHostnames(options.bundledRules));
    }
  }
}
