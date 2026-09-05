// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { announcePresence, PRESENCE_EVENT } from "./beacon";

describe("announcePresence", () => {
  it("sets data attributes the website can read synchronously", () => {
    const root = document.createElement("html");
    announcePresence(root, { version: "0.1.0", extensionId: "abcextensionid" });

    expect(root.dataset.verdictInstalled).toBe("true");
    expect(root.getAttribute("data-verdict-installed")).toBe("true");
    expect(root.dataset.verdictVersion).toBe("0.1.0");
    expect(root.dataset.verdictExtensionId).toBe("abcextensionid");
  });

  it("dispatches a verdict:installed event carrying the same detail", () => {
    const root = document.createElement("html");
    const listener = vi.fn();
    root.addEventListener(PRESENCE_EVENT, listener);

    announcePresence(root, { version: "0.2.0", extensionId: "xyz" });

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toEqual({ version: "0.2.0", extensionId: "xyz" });
  });
});
