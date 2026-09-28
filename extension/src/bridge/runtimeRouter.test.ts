import { describe, expect, it, vi } from "vitest";
import { RELAYED_MESSAGE_TYPE } from "./relay";
import { routeRuntimeMessage, type RuntimeRouterDeps } from "./runtimeRouter";
import { STORAGE_MESSAGE_TYPE } from "../storage/messages";

function deps() {
  return {
    onAnalysisResult: vi.fn<RuntimeRouterDeps["onAnalysisResult"]>(),
    answerBridge: vi.fn<RuntimeRouterDeps["answerBridge"]>(async () => "bridge"),
    serveStorage: vi.fn<RuntimeRouterDeps["serveStorage"]>(async () => "storage"),
  };
}

const SITE_TAB = { tab: { id: 7 }, url: "https://verdict.tools/check", origin: "https://verdict.tools" };
const STOREFRONT_TAB = { tab: { id: 9 }, url: "https://www.amazon.com/dp/B0ABCDEF12" };
const HISTORY_LIST = { type: "verdict:history:list" };
const STORAGE_READ = { type: STORAGE_MESSAGE_TYPE, op: "settings" };

describe("which handler a runtime message reaches", () => {
  it("hands an analysis result to the listeners with the tab it came from, and answers nothing", () => {
    const handlers = deps();
    const answer = routeRuntimeMessage(
      { type: "verdict:analysis-result", outcome: null },
      STOREFRONT_TAB,
      handlers,
    );
    expect(answer).toBeUndefined();
    expect(handlers.onAnalysisResult).toHaveBeenCalledWith(9, null);
    expect(handlers.serveStorage).not.toHaveBeenCalled();
  });

  it("does not take an analysis result from something that is not a tab", async () => {
    const handlers = deps();
    await routeRuntimeMessage({ type: "verdict:analysis-result", outcome: null }, {}, handlers);
    expect(handlers.onAnalysisResult).not.toHaveBeenCalled();
  });

  it("answers the website's relayed message as the website, with the tab's own origin", async () => {
    const handlers = deps();
    const answer = routeRuntimeMessage(
      { type: RELAYED_MESSAGE_TYPE, message: HISTORY_LIST },
      SITE_TAB,
      handlers,
    );
    await expect(answer).resolves.toBe("bridge");
    expect(handlers.answerBridge).toHaveBeenCalledWith(HISTORY_LIST, "https://verdict.tools");
    expect(handlers.serveStorage).not.toHaveBeenCalled();
  });

  it("never lets the website reach storage by wrapping a storage request", async () => {
    const handlers = deps();
    await routeRuntimeMessage(
      { type: RELAYED_MESSAGE_TYPE, message: STORAGE_READ },
      SITE_TAB,
      handlers,
    );
    expect(handlers.serveStorage).not.toHaveBeenCalled();
    expect(handlers.answerBridge).toHaveBeenCalledWith(STORAGE_READ, "https://verdict.tools");
  });

  it("gives a relayed message with no tab behind it no origin, so nothing trusts it", async () => {
    const handlers = deps();
    await routeRuntimeMessage(
      { type: RELAYED_MESSAGE_TYPE, message: HISTORY_LIST },
      { url: "https://verdict.tools/check", origin: "https://verdict.tools" },
      handlers,
    );
    expect(handlers.answerBridge).toHaveBeenCalledWith(HISTORY_LIST, undefined);
  });

  it("judges a relay from a storefront tab by the storefront's origin", async () => {
    const handlers = deps();
    await routeRuntimeMessage(
      { type: RELAYED_MESSAGE_TYPE, message: HISTORY_LIST },
      STOREFRONT_TAB,
      handlers,
    );
    expect(handlers.answerBridge).toHaveBeenCalledWith(HISTORY_LIST, "https://www.amazon.com");
  });

  it("sends everything else to storage, which decides for itself who may ask", async () => {
    const handlers = deps();
    const answer = routeRuntimeMessage(STORAGE_READ, STOREFRONT_TAB, handlers);
    await expect(answer).resolves.toBe("storage");
    expect(handlers.serveStorage).toHaveBeenCalledWith(STORAGE_READ, STOREFRONT_TAB);
    expect(handlers.answerBridge).not.toHaveBeenCalled();
  });

  it("does not treat an unwrapped bridge message as the website", async () => {
    const handlers = deps();
    await routeRuntimeMessage(HISTORY_LIST, SITE_TAB, handlers);
    expect(handlers.answerBridge).not.toHaveBeenCalled();
    expect(handlers.serveStorage).toHaveBeenCalledWith(HISTORY_LIST, SITE_TAB);
  });
});
