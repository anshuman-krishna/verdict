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
  const featureQuantiles = parseFeatureQuantiles(record.featureQuantiles);
  if (
    typeof intercept !== "number" ||
    coefficients === null ||
    calibration === null ||
    featureQuantiles === null
  ) {
    return null;
  }
  return { intercept, coefficients, calibration, featureQuantiles };
}

function parseFeatureQuantiles(value: unknown): Record<string, number[]> | null {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const parsed: Record<string, number[]> = {};
  for (const [name, quantiles] of Object.entries(value)) {
    if (!Array.isArray(quantiles) || quantiles.length === 0) {
      return null;
    }
    const numbers: number[] = [];
    for (const entry of quantiles) {
      if (typeof entry !== "number" || !Number.isFinite(entry)) {
        return null;
      }
      const previous = numbers[numbers.length - 1];
      if (previous !== undefined && entry < previous) {
        return null;
      }
      numbers.push(entry);
    }
    parsed[name] = numbers;
  }
  return parsed;
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

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
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
    if (!isProbability(x) || !isProbability(y)) {
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
