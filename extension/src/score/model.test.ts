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
        featureQuantiles: {},
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

describe("feature quantiles in the artifact", () => {
  const SKETCH = { "temporalBurst.burstFraction": [0, 0.25, 0.9] };

  it("reads a sketch the trainer wrote", () => {
    const parsed = parseModelArtifact({ ...PRESENT, featureQuantiles: SKETCH });
    expect(parsed?.local.featureQuantiles).toEqual(SKETCH);
  });

  it("treats an artifact with no sketch as one that cannot impute", () => {
    expect(parseModelArtifact(PRESENT)?.local.featureQuantiles).toEqual({});
  });

  it("refuses a sketch that is not sorted", () => {
    expect(
      parseModelArtifact({ ...PRESENT, featureQuantiles: { a: [0.5, 0.1] } }),
    ).toBeNull();
  });

  it("refuses an empty sketch, which would be imputed as nothing", () => {
    expect(parseModelArtifact({ ...PRESENT, featureQuantiles: { a: [] } })).toBeNull();
  });

  it("refuses a sketch carrying something that is not a number", () => {
    expect(parseModelArtifact({ ...PRESENT, featureQuantiles: { a: [0, "1"] } })).toBeNull();
  });
});

describe("a calibration curve that is not a probability", () => {
  it("refuses a point mapping to more than one", () => {
    expect(
      parseModelArtifact({ ...PRESENT, calibration: [{ x: 0, y: 0 }, { x: 1, y: 1.4 }] }),
    ).toBeNull();
  });

  it("refuses a negative point", () => {
    expect(
      parseModelArtifact({ ...PRESENT, calibration: [{ x: -0.1, y: 0 }] }),
    ).toBeNull();
  });

  it("refuses a point that is not finite", () => {
    expect(
      parseModelArtifact({ ...PRESENT, calibration: [{ x: 0, y: Number.NaN }] }),
    ).toBeNull();
  });
});
