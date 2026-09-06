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

  // SPEC.md section 13: "verdict never shows a spinner longer than 400 ms
  // without showing partial results underneath."
  it("renders a progress row under the message when one is given", () => {
    const notice = new VerdictNoticeElement();
    notice.render({ message: "Not enough data to judge yet.", busy: true, progress: "1 of 5 pages read." });
    const root = getNoticeShadowRootForTesting(notice);
    expect(root.querySelector(".progress")?.textContent).toBe("1 of 5 pages read.");
  });

  it("renders no progress row when none is given", () => {
    const notice = new VerdictNoticeElement();
    notice.render({ message: "Not enough data to judge yet." });
    expect(getNoticeShadowRootForTesting(notice).querySelector(".progress")).toBeNull();
  });

  it("escapes html in the progress row instead of interpreting it", () => {
    const notice = new VerdictNoticeElement();
    notice.render({ message: "Checking...", progress: "<img src=x onerror=alert(1)>" });
    const root = getNoticeShadowRootForTesting(notice);
    expect(root.querySelector(".progress")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(root.querySelector("img")).toBeNull();
  });

  it("updates the progress row in place, leaving the buttons untouched", () => {
    const notice = new VerdictNoticeElement();
    notice.render({
      message: "Not enough data to judge yet.",
      busy: true,
      action: { label: "check more deeply", pendingLabel: "checking...", onClick: () => {} },
      progress: "Reading up to 5 more pages of reviews.",
    });
    const root = getNoticeShadowRootForTesting(notice);
    const closeBefore = root.querySelector(".close");

    notice.updateProgress("2 of 5 pages read, 48 reviews so far.");

    expect(root.querySelector(".progress")?.textContent).toBe("2 of 5 pages read, 48 reviews so far.");
    expect(root.querySelector(".close")).toBe(closeBefore);
  });

  it("ignores a progress update when the last render carried no progress row", () => {
    const notice = new VerdictNoticeElement();
    notice.render({ message: "Not enough data to judge yet." });
    notice.updateProgress("2 of 5 pages read.");
    expect(getNoticeShadowRootForTesting(notice).querySelector(".progress")).toBeNull();
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
