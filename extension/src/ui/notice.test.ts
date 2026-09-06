// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { getNoticeShadowRootForTesting, VerdictNoticeElement } from "./notice";

describe("VerdictNoticeElement", () => {
  it("renders the message and no action button when none is given", () => {
    const notice = new VerdictNoticeElement();
    notice.render({ message: "Not enough data to judge yet." });
    const root = getNoticeShadowRootForTesting(notice);
    expect(root.querySelector(".message")?.textContent).toBe("Not enough data to judge yet.");
    expect(root.querySelector(".action")).toBeNull();
  });

  it("escapes html in the message instead of interpreting it", () => {
    const notice = new VerdictNoticeElement();
    notice.render({ message: "<script>alert(1)</script>" });
    const root = getNoticeShadowRootForTesting(notice);
    expect(root.querySelector(".message")?.textContent).toBe("<script>alert(1)</script>");
    expect(root.querySelector("script")).toBeNull();
  });

  it("wires the action button's click to the given callback", () => {
    const notice = new VerdictNoticeElement();
    const onClick = vi.fn();
    notice.render({ message: "Not enough data yet.", action: { label: "check more deeply", onClick } });
    const root = getNoticeShadowRootForTesting(notice);
    const button = root.querySelector<HTMLButtonElement>(".action");
    expect(button?.textContent).toBe("check more deeply");
    button?.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disables the action and shows the pending label while busy", () => {
    const notice = new VerdictNoticeElement();
    notice.render({
      message: "Checking...",
      busy: true,
      action: { label: "check more deeply", pendingLabel: "checking...", onClick: () => {} },
    });
    const root = getNoticeShadowRootForTesting(notice);
    const button = root.querySelector<HTMLButtonElement>(".action");
    expect(button?.textContent).toBe("checking...");
    expect(button?.disabled).toBe(true);
  });

  it("dispatches verdict:close when the close button is clicked", () => {
    const notice = new VerdictNoticeElement();
    notice.render({ message: "hello" });
    const handler = vi.fn();
    notice.addEventListener("verdict:close", handler);
    getNoticeShadowRootForTesting(notice).querySelector<HTMLButtonElement>(".close")?.click();
    expect(handler).toHaveBeenCalledOnce();
  });
});
