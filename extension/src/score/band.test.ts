import { describe, expect, it } from "vitest";
import { bandFromProbability } from "./band";

describe("bandFromProbability", () => {
  it("hand computed: quintile boundaries", () => {
    expect(bandFromProbability(0)).toBe("clean");
    expect(bandFromProbability(0.1)).toBe("clean");
    expect(bandFromProbability(0.2)).toBe("mostly-clean");
    expect(bandFromProbability(0.4)).toBe("mixed");
    expect(bandFromProbability(0.6)).toBe("doubtful");
    expect(bandFromProbability(0.8)).toBe("heavily-manipulated");
    expect(bandFromProbability(1)).toBe("heavily-manipulated");
  });

  it("clamps out of range probabilities instead of throwing", () => {
    expect(bandFromProbability(-5)).toBe("clean");
    expect(bandFromProbability(5)).toBe("heavily-manipulated");
  });
});
