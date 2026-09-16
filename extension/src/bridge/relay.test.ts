import { describe, expect, it, vi } from "vitest";
import {
  installRelay,
  isRelayedBridgeMessage,
  isRelayRequestEnvelope,
  MAX_IN_FLIGHT,
  RELAY_CHANNEL,
  RELAY_TIMEOUT_MS,
  RELAYED_MESSAGE_TYPE,
  type RelayTarget,
} from "./relay";

const ORIGIN = "https://verdict.tools";

function fakeWindow() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const posted: { message: unknown; targetOrigin: string }[] = [];
  const target: RelayTarget = {
    location: { origin: ORIGIN },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    postMessage: (message, targetOrigin) => posted.push({ message, targetOrigin }),
  };
  const dispatch = (data: unknown, origin = ORIGIN) => {
    for (const listener of listeners) {
      listener({ data, origin } as MessageEvent);
    }
  };
  return { target, posted, dispatch, listeners };
}

function request(id: string, message: unknown = { type: "verdict:history:list" }) {
  return { channel: RELAY_CHANNEL, direction: "request", id, message };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("isRelayRequestEnvelope", () => {
  it("accepts a well formed request", () => {
    expect(isRelayRequestEnvelope(request("a1"))).toBe(true);
  });

  it("rejects responses, other channels, and unusable ids", () => {
    expect(isRelayRequestEnvelope({ ...request("a1"), direction: "response" })).toBe(false);
    expect(isRelayRequestEnvelope({ ...request("a1"), channel: "someone-else" })).toBe(false);
    expect(isRelayRequestEnvelope(request(""))).toBe(false);
    expect(isRelayRequestEnvelope(request("x".repeat(65)))).toBe(false);
    expect(isRelayRequestEnvelope({ ...request("a1"), id: 7 })).toBe(false);
    expect(isRelayRequestEnvelope(null)).toBe(false);
    expect(isRelayRequestEnvelope("verdict:bridge")).toBe(false);
  });
});

describe("isRelayedBridgeMessage", () => {
  it("recognises only the relay type carrying a message", () => {
    expect(isRelayedBridgeMessage({ type: RELAYED_MESSAGE_TYPE, message: {} })).toBe(true);
    expect(isRelayedBridgeMessage({ type: RELAYED_MESSAGE_TYPE })).toBe(false);
    expect(isRelayedBridgeMessage({ type: "verdict:analysis-result", message: {} })).toBe(false);
  });
});

describe("installRelay", () => {
  it("forwards the inner message and posts the answer back to the page origin only", async () => {
    const { target, posted, dispatch } = fakeWindow();
    const send = vi.fn().mockResolvedValue({ entries: [] });
    installRelay(target, send);

    dispatch(request("r1"));
    await settle();

    expect(send).toHaveBeenCalledWith({
      type: RELAYED_MESSAGE_TYPE,
      message: { type: "verdict:history:list" },
    });
    expect(posted).toEqual([
      {
        message: { channel: RELAY_CHANNEL, direction: "response", id: "r1", response: { entries: [] } },
        targetOrigin: ORIGIN,
      },
    ]);
  });

  it("ignores a message from an embedded frame of another origin", async () => {
    const { target, posted, dispatch } = fakeWindow();
    const send = vi.fn().mockResolvedValue({ ok: true });
    installRelay(target, send);

    dispatch(request("r1"), "https://ads.example");
    await settle();

    expect(send).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it("ignores its own responses, so it never loops", async () => {
    const { target, dispatch } = fakeWindow();
    const send = vi.fn().mockResolvedValue({ ok: true });
    installRelay(target, send);

    dispatch({ channel: RELAY_CHANNEL, direction: "response", id: "r1", response: {} });
    await settle();

    expect(send).not.toHaveBeenCalled();
  });

  it("answers with an error when the extension cannot be reached, rather than never", async () => {
    const { target, posted, dispatch } = fakeWindow();
    installRelay(target, vi.fn().mockRejectedValue(new Error("context invalidated")));

    dispatch(request("r1"));
    await settle();

    expect(posted.map((entry) => entry.message)).toEqual([
      { channel: RELAY_CHANNEL, direction: "response", id: "r1", response: { error: "extension unavailable" } },
    ]);
  });

  it("turns an empty answer into an error the page can show", async () => {
    const { target, posted, dispatch } = fakeWindow();
    installRelay(target, vi.fn().mockResolvedValue(undefined));

    dispatch(request("r1"));
    await settle();

    expect((posted[0]?.message as { response: unknown }).response).toEqual({ error: "no response" });
  });

  it("refuses beyond the in flight cap, and frees a slot once an answer lands", async () => {
    const { target, posted, dispatch } = fakeWindow();
    const pending: ((value: unknown) => void)[] = [];
    const send = vi.fn().mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    installRelay(target, send);

    for (let index = 0; index <= MAX_IN_FLIGHT; index += 1) {
      dispatch(request(`r${index}`));
    }
    expect(send).toHaveBeenCalledTimes(MAX_IN_FLIGHT);
    expect(posted.map((entry) => entry.message)).toEqual([
      { channel: RELAY_CHANNEL, direction: "response", id: `r${MAX_IN_FLIGHT}`, response: { error: "busy" } },
    ]);

    pending[0]?.({ ok: true });
    await settle();
    dispatch(request("later"));
    expect(send).toHaveBeenCalledTimes(MAX_IN_FLIGHT + 1);
  });

  it("stops listening once removed", () => {
    const { target, listeners } = fakeWindow();
    const remove = installRelay(target, vi.fn());
    expect(listeners.size).toBe(1);
    remove();
    expect(listeners.size).toBe(0);
  });
});

describe("a background that never answers", () => {
  it("gives the slot back rather than wedging the page at the in flight cap", async () => {
    const { target, posted, dispatch } = fakeWindow();
    installRelay(target, () => new Promise(() => {}), { timeoutMs: 0 });

    for (let i = 0; i < MAX_IN_FLIGHT; i++) {
      dispatch(request(`wedge-${i}`));
    }
    await settle();
    expect(posted).toHaveLength(MAX_IN_FLIGHT);
    for (const { message } of posted) {
      expect(message).toMatchObject({ response: { error: "extension unavailable" } });
    }

    dispatch(request("after"));
    await settle();
    expect(posted.at(-1)?.message).toMatchObject({
      id: "after",
      response: { error: "extension unavailable" },
    });
  });

  it("answers a late reply only once", async () => {
    const { target, posted, dispatch } = fakeWindow();
    let answer: (value: unknown) => void = () => {};
    installRelay(target, () => new Promise((resolve) => {
      answer = resolve;
    }), { timeoutMs: 0 });

    dispatch(request("slow"));
    await settle();
    answer({ entries: [] });
    await settle();

    expect(posted).toHaveLength(1);
  });

  it("waits longer than a hidden tab analysis before giving up", () => {
    expect(RELAY_TIMEOUT_MS).toBeGreaterThan(15_000);
  });
});
