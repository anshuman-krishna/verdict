import { describe, expect, it, vi } from "vitest";
import {
  ANALYZE_TIMEOUT_MS,
  BridgeError,
  type BridgeEnvironment,
  chooseTransport,
  DEFAULT_TIMEOUT_MS,
  RELAY_ATTRIBUTE as SITE_RELAY_ATTRIBUTE,
  RELAY_CHANNEL as SITE_RELAY_CHANNEL,
  sendToExtension,
} from "../../site/src/lib/extensionBridge";
import { armedConfirmation } from "../../site/src/lib/confirmAction";
import { installRelay, RELAY_ATTRIBUTE, RELAY_CHANNEL, RELAYED_MESSAGE_TYPE } from "../src/bridge/relay";

const ORIGIN = "https://verdict.tools";

// page and relay share one window
function sharedWindow(attributes: Record<string, string> = {}) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let nextId = 1;
  const window = {
    location: { origin: ORIGIN },
    chrome: undefined as BridgeEnvironment["window"]["chrome"],
    addEventListener: (_type: "message", listener: (event: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: "message", listener: (event: MessageEvent) => void) => listeners.delete(listener),
    postMessage: (data: unknown, targetOrigin: string) => {
      expect(targetOrigin).toBe(ORIGIN);
      queueMicrotask(() => {
        for (const listener of [...listeners]) {
          listener({ data, origin: ORIGIN } as MessageEvent);
        }
      });
    },
  };
  const environment: BridgeEnvironment = {
    window,
    root: { getAttribute: (name) => attributes[name] ?? null },
    setTimeout: (handler) => {
      const handle = nextTimer++;
      timers.set(handle, handler);
      return handle;
    },
    clearTimeout: (handle) => timers.delete(handle as number),
    randomId: () => `id-${nextId++}`,
  };
  const fireTimers = () => {
    for (const [handle, handler] of [...timers]) {
      timers.delete(handle);
      handler();
    }
  };
  return { window, environment, listeners, timers, fireTimers };
}

describe("the site and the extension agree on the relay", () => {
  it("uses the same channel and attribute on both sides", () => {
    expect(SITE_RELAY_CHANNEL).toBe(RELAY_CHANNEL);
    expect(SITE_RELAY_ATTRIBUTE).toBe(RELAY_ATTRIBUTE);
  });

  it("carries a request to the background and its answer back to the caller", async () => {
    const { window, environment } = sharedWindow({ [RELAY_ATTRIBUTE]: "true" });
    const background = vi.fn().mockResolvedValue({ entries: [{ id: 1 }] });
    installRelay(window, background);

    await expect(sendToExtension("verdict:history:list", {}, { environment })).resolves.toEqual({
      entries: [{ id: 1 }],
    });
    expect(background).toHaveBeenCalledWith({
      type: RELAYED_MESSAGE_TYPE,
      message: { type: "verdict:history:list" },
    });
  });

  it("keeps concurrent requests apart", async () => {
    const { window, environment } = sharedWindow({ [RELAY_ATTRIBUTE]: "true" });
    installRelay(window, async (relayed) => {
      const message = relayed.message as { type: string; id?: number };
      return { report: { serial: `for-${message.id}` } };
    });

    const [first, second] = await Promise.all([
      sendToExtension("verdict:report:get", { id: 1 }, { environment }),
      sendToExtension("verdict:report:get", { id: 2 }, { environment }),
    ]);

    expect(first).toEqual({ report: { serial: "for-1" } });
    expect(second).toEqual({ report: { serial: "for-2" } });
  });

  it("turns a bridge refusal into a BridgeError naming it", async () => {
    const { window, environment } = sharedWindow({ [RELAY_ATTRIBUTE]: "true" });
    installRelay(window, async () => ({ error: "rate limited" }));

    const failure = sendToExtension("verdict:analyze", { url: "https://www.amazon.com/dp/B000000000" }, { environment });
    await expect(failure).rejects.toBeInstanceOf(BridgeError);
    await expect(failure).rejects.toThrow("rate limited");
  });

  it("never lets extra fields replace the message type", async () => {
    const { window, environment } = sharedWindow({ [RELAY_ATTRIBUTE]: "true" });
    const background = vi.fn().mockResolvedValue({ ok: true });
    installRelay(window, background);

    await sendToExtension("verdict:history:list", { type: "verdict:history:clear" }, { environment });

    expect(background.mock.calls[0]?.[0].message).toEqual({ type: "verdict:history:list" });
  });

  it("gives up when nothing answers, and stops listening", async () => {
    const { environment, listeners, fireTimers } = sharedWindow({ [RELAY_ATTRIBUTE]: "true" });

    const pending = sendToExtension("verdict:history:list", {}, { environment });
    fireTimers();

    await expect(pending).rejects.toThrow("did not answer in time");
    expect(listeners.size).toBe(0);
  });

  it("allows an analysis far longer than a history read", () => {
    expect(ANALYZE_TIMEOUT_MS).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
  });
});

describe("chooseTransport", () => {
  const runtime = { sendMessage: vi.fn() };

  it("prefers the relay, which every browser has", () => {
    const { environment, window } = sharedWindow({ [RELAY_ATTRIBUTE]: "true", "data-verdict-extension-id": "abc" });
    window.chrome = { runtime };
    expect(chooseTransport(environment)).toBe("relay");
  });

  it("falls back to direct messaging for an extension older than the relay", () => {
    const { environment, window } = sharedWindow({ "data-verdict-extension-id": "abc" });
    window.chrome = { runtime };
    expect(chooseTransport(environment)).toBe("direct");
  });

  it("has nothing to use without either", async () => {
    const { environment } = sharedWindow({ "data-verdict-extension-id": "abc" });
    expect(chooseTransport(environment)).toBeNull();
    await expect(sendToExtension("verdict:history:list", {}, { environment })).rejects.toBeInstanceOf(BridgeError);
  });
});

describe("direct messaging", () => {
  it("resolves the answer and reports lastError as a failure", async () => {
    const { environment, window } = sharedWindow({ "data-verdict-extension-id": "abc" });
    type Callback = (response: unknown) => void;
    const sendMessage = vi.fn((_id: string, _message: unknown, callback: Callback) => callback({ entries: [] }));
    const chromeRuntime: { sendMessage: typeof sendMessage; lastError?: { message?: string } } = { sendMessage };
    window.chrome = { runtime: chromeRuntime };

    await expect(sendToExtension("verdict:history:list", {}, { environment })).resolves.toEqual({ entries: [] });
    expect(sendMessage).toHaveBeenCalledWith("abc", { type: "verdict:history:list" }, expect.any(Function));

    sendMessage.mockImplementation((_id: string, _message: unknown, callback: Callback) => {
      chromeRuntime.lastError = { message: "Could not establish connection" };
      callback(undefined);
    });
    await expect(sendToExtension("verdict:history:list", {}, { environment })).rejects.toThrow(
      "Could not establish connection",
    );
  });

  it("times out rather than waiting on a callback that never comes", async () => {
    const { environment, window, fireTimers } = sharedWindow({ "data-verdict-extension-id": "abc" });
    window.chrome = { runtime: { sendMessage: vi.fn() } };

    const pending = sendToExtension("verdict:history:list", {}, { environment });
    fireTimers();
    await expect(pending).rejects.toThrow("did not answer in time");
  });
});

describe("armedConfirmation", () => {
  function harness() {
    const labels: string[] = [];
    const timers = new Map<number, () => void>();
    let next = 1;
    const confirmation = armedConfirmation({
      label: "Delete everything",
      armedLabel: "Click again",
      windowMs: 5000,
      setLabel: (label) => labels.push(label),
      setTimeout: (handler) => {
        timers.set(next, handler);
        return next++;
      },
      clearTimeout: (handle) => timers.delete(handle as number),
    });
    return { confirmation, labels, timers };
  }

  it("does nothing on the first press and confirms on the second", () => {
    const { confirmation, labels } = harness();
    expect(confirmation.press()).toBe(false);
    expect(confirmation.isArmed()).toBe(true);
    expect(confirmation.press()).toBe(true);
    expect(confirmation.isArmed()).toBe(false);
    expect(labels).toEqual(["Click again", "Delete everything"]);
  });

  it("disarms on its own, so a press much later starts over", () => {
    const { confirmation, timers } = harness();
    confirmation.press();
    for (const handler of timers.values()) {
      handler();
    }
    expect(confirmation.isArmed()).toBe(false);
    expect(confirmation.press()).toBe(false);
  });
});
