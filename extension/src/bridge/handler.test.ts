import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { RulesDocument } from "../extract/rules";
import { addHistoryEntry, deleteAllHistory } from "../storage/history";
import { deriveAllowedHostnames, handleBridgeMessage } from "./handler";
import { isBridgeRequest } from "./messages";

const RULES: RulesDocument = {
  version: 1,
  site: "amazon",
  locales: ["com", "co.uk"],
  fields: {},
};

describe("isBridgeRequest", () => {
  it("accepts every declared message shape", () => {
    expect(isBridgeRequest({ type: "verdict:history:list" })).toBe(true);
    expect(isBridgeRequest({ type: "verdict:history:clear" })).toBe(true);
    expect(isBridgeRequest({ type: "verdict:analyze", url: "https://amazon.com/dp/x" })).toBe(
      true,
    );
  });

  it("rejects an analyze request missing its url", () => {
    expect(isBridgeRequest({ type: "verdict:analyze" })).toBe(false);
  });

  it("rejects an unrecognised type, and non object input", () => {
    expect(isBridgeRequest({ type: "verdict:delete:everything" })).toBe(false);
    expect(isBridgeRequest(null)).toBe(false);
    expect(isBridgeRequest("verdict:history:list")).toBe(false);
  });
});

describe("deriveAllowedHostnames", () => {
  it("joins site and locale with a dot", () => {
    expect(deriveAllowedHostnames(RULES)).toEqual(["amazon.com", "amazon.co.uk"]);
  });
});

describe("handleBridgeMessage", () => {
  it("rejects a message that is not a recognised bridge request", async () => {
    const response = await handleBridgeMessage({ type: "not:a:thing" }, { bundledRules: RULES });
    expect(response).toEqual({ error: "unrecognised message" });
  });

  it("lists history entries with their report summarized", async () => {
    await deleteAllHistory();
    await addHistoryEntry({
      title: "wireless mouse",
      thumbnailUrl: "https://x/y.jpg",
      report: { band: "mixed", claimedRating: 4.5, adjustedRating: 3.9 },
    });

    const response = await handleBridgeMessage(
      { type: "verdict:history:list" },
      { bundledRules: RULES },
    );

    expect(response).toEqual({
      entries: [
        {
          id: expect.any(Number),
          timestamp: expect.any(Number),
          title: "wireless mouse",
          thumbnailUrl: "https://x/y.jpg",
          band: "mixed",
          claimedRating: 4.5,
          adjustedRating: 3.9,
        },
      ],
    });
  });

  it("clears history", async () => {
    await addHistoryEntry({ title: "will be cleared", thumbnailUrl: null, report: {} });
    const response = await handleBridgeMessage(
      { type: "verdict:history:clear" },
      { bundledRules: RULES },
    );
    expect(response).toEqual({ ok: true });

    const after = await handleBridgeMessage(
      { type: "verdict:history:list" },
      { bundledRules: RULES },
    );
    expect(after).toEqual({ entries: [] });
  });

  it("rejects an analyze request for a domain outside the bundled rules", async () => {
    const response = await handleBridgeMessage(
      { type: "verdict:analyze", url: "https://not-a-supported-store.example/product/1" },
      { bundledRules: RULES },
    );
    expect(response).toEqual({ status: "unsupported-domain" });
  });

  it("rejects an analyze request that is not even a valid url", async () => {
    const response = await handleBridgeMessage(
      { type: "verdict:analyze", url: "not a url" },
      { bundledRules: RULES },
    );
    expect(response).toEqual({ status: "unsupported-domain" });
  });

  it("accepts a supported domain, including a www subdomain, but has no pipeline wired up yet", async () => {
    const bare = await handleBridgeMessage(
      { type: "verdict:analyze", url: "https://amazon.com/dp/B000000000" },
      { bundledRules: RULES },
    );
    expect(bare).toEqual({ status: "not-implemented" });

    const withSubdomain = await handleBridgeMessage(
      { type: "verdict:analyze", url: "https://www.amazon.co.uk/dp/B000000000" },
      { bundledRules: RULES },
    );
    expect(withSubdomain).toEqual({ status: "not-implemented" });
  });

  it("does not let a lookalike hostname past the dot boundary check", async () => {
    const response = await handleBridgeMessage(
      { type: "verdict:analyze", url: "https://evil-amazon.com/dp/x" },
      { bundledRules: RULES },
    );
    expect(response).toEqual({ status: "unsupported-domain" });
  });
});
