import type { CalibrationPoint, CombinerModel, ModelSet } from "./combine";
import artifact from "./model.json";


// absence is stated, never implied
export const ARTIFACT_VERSION = 1;

function parseModel(value: unknown): CombinerModel | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const intercept = record.intercept;
  const coefficients = parseCoefficients(record.coefficients);
  const calibration = parseCalibration(record.calibration);
  if (typeof intercept !== "number" || coefficients === null || calibration === null) {
    return null;
  }
  return { intercept, coefficients, calibration };
}

export function parseModelArtifact(data: unknown): ModelSet | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (record.artifactVersion !== ARTIFACT_VERSION || record.present !== true) {
    return null;
  }
  const local = parseModel(record);
  if (local === null) {
    return null;
  }
  return {
    local,
    reviewerGraph: record.reviewerGraph === undefined ? null : parseModel(record.reviewerGraph),
  };
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

export const BUNDLED_MODEL: ModelSet | null = parseModelArtifact(artifact);
