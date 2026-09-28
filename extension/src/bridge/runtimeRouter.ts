import { isAnalysisResultMessage } from "../contentScript/internalMessages";
import type { ReportOutcome } from "../score/buildReport";
import { senderOrigin } from "./origins";
import { isRelayedBridgeMessage } from "./relay";

export interface RuntimeSender {
  origin?: string;
  url?: string;
  tab?: { id?: number };
}

export interface RuntimeRouterDeps {
  onAnalysisResult: (tabId: number, outcome: ReportOutcome | null) => void;
  answerBridge: (message: unknown, origin: string | undefined) => Promise<unknown>;
  serveStorage: (message: unknown, sender: RuntimeSender) => Promise<unknown>;
}

// undefined means nothing will answer, so the port can close
export function routeRuntimeMessage(
  message: unknown,
  sender: RuntimeSender,
  deps: RuntimeRouterDeps,
): Promise<unknown> | undefined {
  const tabId = sender.tab?.id;
  if (isAnalysisResultMessage(message) && tabId !== undefined) {
    deps.onAnalysisResult(tabId, message.outcome);
    return undefined;
  }
  // the website only ever arrives wrapped, so it is judged as the website and never reaches storage
  if (isRelayedBridgeMessage(message)) {
    return deps.answerBridge(message.message, sender.tab === undefined ? undefined : senderOrigin(sender));
  }
  // the storefront page shares its storage with our content script, so the writing happens here
  return deps.serveStorage(message, sender);
}
