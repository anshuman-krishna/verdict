import { describe, expect, it } from "vitest";
import { rosetteParams, rosettePath } from "./rosette";

describe("rosetteParams", () => {
  it("hand computed: zero shares give the base harmonic and minimum amplitude", () => {
    const params = rosetteParams({
      burstShare: 0,
      duplicateShare: 0,
      estimatedInorganicShare: 0,
      band: "clean",
    });
    expect(params.harmonicA).toBe(3);
    expect(params.harmonicB).toBe(4);
    expect(params.amplitude).toBeCloseTo(0.15, 10);
    expect(params.strokeColor).toBe("#2E6B4E");
  });

  it("hand computed: full shares give the widest spread and maximum amplitude", () => {
    const params = rosetteParams({
      burstShare: 1,
      duplicateShare: 1,
      estimatedInorganicShare: 1,
      band: "heavily-manipulated",
    });
    expect(params.harmonicA).toBe(7);
    expect(params.harmonicB).toBe(12);
    expect(params.amplitude).toBeCloseTo(0.8, 10);
    expect(params.strokeColor).toBe("#9C382F");
  });

  it("clamps shares outside 0 to 1 rather than producing negative harmonics", () => {
    const params = rosetteParams({
      burstShare: -5,
      duplicateShare: 5,
      estimatedInorganicShare: -1,
      band: "mixed",
    });
    expect(params.harmonicA).toBe(3);
    expect(params.harmonicB).toBe(8);
    expect(params.amplitude).toBeCloseTo(0.15, 10);
  });
});

describe("rosettePath", () => {
  it("hand computed: starts and ends at the same point, tracing a closed loop", () => {
    const params = rosetteParams({
      burstShare: 0.4,
      duplicateShare: 0.2,
      estimatedInorganicShare: 0.5,
      band: "mixed",
    });
    const path = rosettePath(params, 100, 8);
    const commands = path.split(" ");
    expect(commands[0]).toBe("M");
    expect(path.endsWith("Z")).toBe(true);
  });

  it("hand computed: at t=0 both harmonics have cosine 1, so radius is exactly (1 + 0) * base = base", () => {
    const params = rosetteParams({
      burstShare: 0,
      duplicateShare: 0,
      estimatedInorganicShare: 0.5,
      band: "clean",
    });
    const path = rosettePath(params, 100, 4);
    const firstPoint = path.split(" ").slice(1, 3).map(Number);
    expect(firstPoint[0]).toBeCloseTo(100, 3);
    expect(firstPoint[1]).toBeCloseTo(0, 3);
  });

  it("treats a requested sample count below 1 as 1, tracing t=0 to t=2pi", () => {
    const params = rosetteParams({
      burstShare: 0,
      duplicateShare: 0,
      estimatedInorganicShare: 0,
      band: "clean",
    });
    expect(rosettePath(params, 100, 0)).toBe("M 100.000 0.000 L 100.000 -0.000 Z");
  });
});
