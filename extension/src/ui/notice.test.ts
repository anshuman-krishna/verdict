// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { newTranslator } from "../i18n/translator";
import {
  createNoticeElement,
  getNoticeShadowRootForTesting,
  safeNoticeHref,
} from "./notice";

// chrome gives a content script's isolated world no custom element registry at all
describe("the notice inside a content script", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loads and draws with customElements set to null", async () => {
    vi.stubGlobal("customElements", null);
    vi.resetModules();
    const fresh = await import("./notice");
    const notice = fresh.createNoticeElement(document);
    notice.render({ message: "Reading reviews." });
    expect(fresh.getNoticeShadowRootForTesting(notice).textContent).toContain("Reading reviews.");
  });
});

describe("the notice element", () => {
  it("says which language its words are in, not the storefront's", () => {
    const notice = createNoticeElement(document);
    notice.render({ message: "Lesen." }, newTranslator("de-DE", {}, "de"));
    expect(getNoticeShadowRootForTesting(notice).querySelector(".notice")?.getAttribute("lang")).toBe("de");
  });

  it("renders the message and no action button when none is given", () => {
    const notice = createNoticeElement(document);
    notice.render({ message: "Not enough data to judge yet." });
    const root = getNoticeShadowRootForTesting(notice);
    expect(root.querySelector(".message")?.textContent).toBe("Not enough data to judge yet.");
    expect(root.querySelector(".action")).toBeNull();
  });

  it("escapes html in the message instead of interpreting it", () => {
    const notice = createNoticeElement(document);
    notice.render({ message: "<script>alert(1)</script>" });
    const root = getNoticeShadowRootForTesting(notice);
    expect(root.querySelector(".message")?.textContent).toBe("<script>alert(1)</script>");
    expect(root.querySelector("script")).toBeNull();
  });

  it("wires the action button's click to the given callback", () => {
    const notice = createNoticeElement(document);
    const onClick = vi.fn();
    notice.render({ message: "Not enough data yet.", action: { label: "check more deeply", onClick } });
    const root = getNoticeShadowRootForTesting(notice);
    const button = root.querySelector<HTMLButtonElement>(".action");
    expect(button?.textContent).toBe("check more deeply");
    button?.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders a progress row under the message when one is given", () => {
    const notice = createNoticeElement(document);
    notice.render({ message: "Not enough data to judge yet.", busy: true, progress: "1 of 5 pages read." });
    const root = getNoticeShadowRootForTesting(notice);
    expect(root.querySelector(".progress")?.textContent).toBe("1 of 5 pages read.");
  });

  it("renders no progress row when none is given", () => {
    const notice = createNoticeElement(document);
    notice.render({ message: "Not enough data to judge yet." });
    expect(getNoticeShadowRootForTesting(notice).querySelector(".progress")).toBeNull();
  });

  it("escapes html in the progress row instead of interpreting it", () => {
    const notice = createNoticeElement(document);
    notice.render({ message: "Checking...", progress: "<img src=x onerror=alert(1)>" });
    const root = getNoticeShadowRootForTesting(notice);
    expect(root.querySelector(".progress")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(root.querySelector("img")).toBeNull();
  });

  it("updates the progress row in place, leaving the buttons untouched", () => {
    const notice = createNoticeElement(document);
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
    const notice = createNoticeElement(document);
    notice.render({ message: "Not enough data to judge yet." });
    notice.updateProgress("2 of 5 pages read.");
    expect(getNoticeShadowRootForTesting(notice).querySelector(".progress")).toBeNull();
  });

  it("disables the action and shows the pending label while busy", () => {
    const notice = createNoticeElement(document);
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
    const notice = createNoticeElement(document);
    notice.render({ message: "hello" });
    const handler = vi.fn();
    notice.addEventListener("verdict:close", handler);
    getNoticeShadowRootForTesting(notice).querySelector<HTMLButtonElement>(".close")?.click();
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("a link on a notice", () => {
  it("renders one that points at our own site", () => {
    const notice = createNoticeElement(document);
    notice.render({
      message: "Verdict could not read this page.",
      link: { label: "extraction status", href: "https://verdict.tools/status" },
    });

    const link = getNoticeShadowRootForTesting(notice).querySelector<HTMLAnchorElement>(".link");
    expect(link?.textContent).toBe("extraction status");
    expect(link?.getAttribute("href")).toBe("https://verdict.tools/status");
    expect(link?.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders none at all when there is no link", () => {
    const notice = createNoticeElement(document);
    notice.render({ message: "anything" });
    expect(getNoticeShadowRootForTesting(notice).querySelector(".link")).toBeNull();
  });

  it("takes only our own pages, so a page cannot aim it anywhere", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,x",
      "https://verdict.tools.evil.example/status",
      "http://verdict.tools/status",
      "//verdict.tools/status",
    ]) {
      expect(safeNoticeHref(href)).toBeNull();
    }
  });

  it("drops a link it will not follow rather than rendering a dead one", () => {
    const notice = createNoticeElement(document);
    notice.render({ message: "anything", link: { label: "somewhere", href: "javascript:alert(1)" } });
    expect(getNoticeShadowRootForTesting(notice).querySelector(".link")).toBeNull();
  });
});
