import { describe, expect, it } from "vitest";
import { isAnalysisResultMessage } from "./internalMessages";

describe("isAnalysisResultMessage", () => {
  it("accepts a message with the right type, regardless of the outcome shape", () => {
    expect(isAnalysisResultMessage({ type: "verdict:analysis-result", outcome: null })).toBe(true);
    expect(
      isAnalysisResultMessage({ type: "verdict:analysis-result", outcome: { status: "no-model" } }),
    ).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isAnalysisResultMessage({ type: "verdict:history:list" })).toBe(false);
    expect(isAnalysisResultMessage(null)).toBe(false);
    expect(isAnalysisResultMessage("verdict:analysis-result")).toBe(false);
    expect(isAnalysisResultMessage(undefined)).toBe(false);
  });
});
