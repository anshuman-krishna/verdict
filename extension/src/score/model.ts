import type { CalibrationPoint, CombinerModel } from "./combine";
import artifact from "./model.json";

// SPEC.md section 4: "output artefact is model.json, a small parameter file bundled into the
// extension at build time". That file is written by the research pipeline
// (research/verdict_research/model/cli.py) straight into this directory, so the bundle takes it by
// import rather than by a copy step somebody has to remember.
//
// model.json states absence rather than implying it. A model that does not exist yet, one exported
// from a version this build does not understand, and one that is malformed all resolve to null
// here, and buildReport.ts turns null into { status: "no-model" }. Nothing in this file substitutes
// a zero, a default coefficient, or an uncalibrated probability, because every one of those would
// read downstream as a real model reporting no risk, and SPEC.md section 6's minimum data
// thresholds point the same way: under them the report says "not enough data", never a score.

export const ARTIFACT_VERSION = 1;

export function parseModelArtifact(data: unknown): CombinerModel | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (record.artifactVersion !== ARTIFACT_VERSION || record.present !== true) {
    return null;
  }
  const intercept = record.intercept;
  const coefficients = parseCoefficients(record.coefficients);
  const calibration = parseCalibration(record.calibration);
  if (typeof intercept !== "number" || coefficients === null || calibration === null) {
    return null;
  }
  return { intercept, coefficients, calibration };
}

function parseCoefficients(value: unknown): Record<string, number> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const parsed: Record<string, number> = {};
  for (const [name, weight] of Object.entries(value)) {
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      return null;
    }
    parsed[name] = weight;
  }
  return parsed;
}

// combine.ts interpolates between these points, so out of order knots would
// silently produce a wrong probability rather than an obvious failure. The
// order is checked here, once, instead of being assumed there.
function parseCalibration(value: unknown): CalibrationPoint[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const points: CalibrationPoint[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const { x, y } = entry as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number") {
      return null;
    }
    const previous = points[points.length - 1];
    if (previous !== undefined && x < previous.x) {
      return null;
    }
    points.push({ x, y });
  }
  return points;
}

export const BUNDLED_MODEL: CombinerModel | null = parseModelArtifact(artifact);
