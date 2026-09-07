// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { resolveField, resolveFieldTraced } from "./interpreter";
import type { FieldRule } from "./rules";

function parse(html: string): ParentNode {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("resolveFieldTraced", () => {
  it("records the one strategy that matched", () => {
    const root = parse(`<span class="rating">4.6</span>`);
    const rule: FieldRule = { strategy: "selector", value: ".rating" };
    expect(resolveFieldTraced(root, rule)).toEqual({
      values: ["4.6"],
      trace: [{ strategy: "selector", depth: 0, target: ".rating", matched: 1 }],
    });
  });

  it("records every step of a fallback chain, in order", () => {
    const root = parse(`<span class="legacy-rating">4.6</span>`);
    const rule: FieldRule = {
      strategy: "embedded-json",
      path: "$.rating",
      fallback: {
        strategy: "selector",
        value: ".rating",
        fallback: { strategy: "selector", value: ".legacy-rating" },
      },
    };
    const traced = resolveFieldTraced(root, rule);
    expect(traced.values).toEqual(["4.6"]);
    expect(traced.trace).toEqual([
      { strategy: "embedded-json", depth: 0, target: "$.rating", matched: 0 },
      { strategy: "selector", depth: 1, target: ".rating", matched: 0 },
      { strategy: "selector", depth: 2, target: ".legacy-rating", matched: 1 },
    ]);
  });

  it("records the whole chain when nothing matches", () => {
    const root = parse(`<div></div>`);
    const rule: FieldRule = {
      strategy: "selector",
      value: ".rating",
      fallback: { strategy: "selector", value: ".legacy-rating" },
    };
    const traced = resolveFieldTraced(root, rule);
    expect(traced.values).toEqual([]);
    expect(traced.trace.map((step) => step.matched)).toEqual([0, 0]);
  });

  it("records a strategy whose selector is invalid as a step that matched nothing", () => {
    const root = parse(`<span class="rating">4.6</span>`);
    const rule: FieldRule = {
      strategy: "selector",
      value: ":::",
      fallback: { strategy: "selector", value: ".rating" },
    };
    expect(resolveFieldTraced(root, rule).trace).toEqual([
      { strategy: "selector", depth: 0, target: ":::", matched: 0 },
      { strategy: "selector", depth: 1, target: ".rating", matched: 1 },
    ]);
  });

  it("agrees with resolveField, which delegates to it", () => {
    const root = parse(`<span class="rating">4.6</span>`);
    const rule: FieldRule = { strategy: "selector", value: ".rating" };
    expect(resolveField(root, rule)).toEqual(resolveFieldTraced(root, rule).values);
  });
});
