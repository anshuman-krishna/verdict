import { describe, expect, it } from "vitest";
import committed from "./model.json";
import { ARTIFACT_VERSION, BUNDLED_MODEL, parseModelArtifact } from "./model";

const PRESENT = {
  artifactVersion: ARTIFACT_VERSION,
  present: true,
  intercept: -1.5,
  coefficients: { "temporalBurst.burstFraction": 2.25 },
  calibration: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.4 },
    { x: 1, y: 1 },
  ],
};

describe("parseModelArtifact", () => {
  it("reads a complete artifact", () => {
    expect(parseModelArtifact(PRESENT)).toEqual({
      local: {
        intercept: -1.5,
        coefficients: { "temporalBurst.burstFraction": 2.25 },
        calibration: PRESENT.calibration,
      },
      reviewerGraph: null,
    });
  });

  it("reads the absent form as no model", () => {
    expect(
      parseModelArtifact({ artifactVersion: ARTIFACT_VERSION, present: false, reason: "none yet" }),
    ).toBeNull();
  });

  it("refuses an artifact version this build does not understand", () => {
    expect(parseModelArtifact({ ...PRESENT, artifactVersion: ARTIFACT_VERSION + 1 })).toBeNull();
  });

  it("refuses a present artifact missing its intercept", () => {
    const { intercept: _omitted, ...withoutIntercept } = PRESENT;
    expect(parseModelArtifact(withoutIntercept)).toBeNull();
  });

  it("refuses a non numeric coefficient", () => {
    expect(parseModelArtifact({ ...PRESENT, coefficients: { a: "2.25" } })).toBeNull();
  });

  it("refuses a coefficient that is not finite", () => {
    expect(parseModelArtifact({ ...PRESENT, coefficients: { a: Number.NaN } })).toBeNull();
  });

  it("refuses calibration knots that are out of order", () => {
    expect(
      parseModelArtifact({
        ...PRESENT,
        calibration: [
          { x: 0.5, y: 0.4 },
          { x: 0.1, y: 0.9 },
        ],
      }),
    ).toBeNull();
  });

  it("refuses a calibration entry that is not a point", () => {
    expect(parseModelArtifact({ ...PRESENT, calibration: [{ x: 0 }] })).toBeNull();
  });

  it("accepts an empty calibration curve, which combine.ts treats as identity", () => {
    expect(parseModelArtifact({ ...PRESENT, calibration: [] })?.local.calibration).toEqual([]);
  });

  it("reads an optional reviewer graph model alongside the local one", () => {
    const parsed = parseModelArtifact({
      ...PRESENT,
      reviewerGraph: {
        intercept: 0.5,
        coefficients: { "reviewerGraph.flaggedReviewShare": 1.75 },
        calibration: [],
      },
    });
    expect(parsed?.reviewerGraph?.coefficients).toEqual({
      "reviewerGraph.flaggedReviewShare": 1.75,
    });
    expect(parsed?.local.intercept).toBe(-1.5);
  });

  it("drops a malformed reviewer graph block and keeps the local model", () => {
    const parsed = parseModelArtifact({ ...PRESENT, reviewerGraph: { intercept: "no" } });
    expect(parsed?.reviewerGraph).toBeNull();
    expect(parsed?.local.intercept).toBe(-1.5);
  });

  it("refuses anything that is not an object", () => {
    expect(parseModelArtifact(null)).toBeNull();
    expect(parseModelArtifact([PRESENT])).toBeNull();
    expect(parseModelArtifact("model")).toBeNull();
  });
});

describe("the committed model.json", () => {
  it("is either the stated absent form or a model that parses", () => {
    const record = committed as Record<string, unknown>;
    expect(record.artifactVersion).toBe(ARTIFACT_VERSION);
    if (record.present === true) {
      expect(BUNDLED_MODEL).not.toBeNull();
    } else {
      expect(record.present).toBe(false);
      expect(typeof record.reason).toBe("string");
      expect(BUNDLED_MODEL).toBeNull();
    }
  });
});
