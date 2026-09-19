import { describe, expect, it } from "vitest";
import { CheckTabs } from "./checkTabs";

describe("CheckTabs", () => {
  it("knows a tab it was told about", () => {
    const tabs = new CheckTabs();
    tabs.remember(7);
    expect(tabs.has(7)).toBe(true);
    expect(tabs.has(8)).toBe(false);
  });

  it("knows nothing about a tab with no id", () => {
    expect(new CheckTabs().has(undefined)).toBe(false);
  });

  it("forgets a tab as it closes, so an id the browser reuses is not a check", () => {
    const tabs = new CheckTabs();
    tabs.remember(7);
    tabs.forget(7);
    expect(tabs.has(7)).toBe(false);
    expect(tabs.size).toBe(0);
  });

  it("forgetting a tab it never knew changes nothing", () => {
    const tabs = new CheckTabs();
    tabs.remember(7);
    tabs.forget(9);
    expect(tabs.size).toBe(1);
  });
});
