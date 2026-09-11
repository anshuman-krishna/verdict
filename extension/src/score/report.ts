export type Band = "clean" | "mostly-clean" | "mixed" | "doubtful" | "heavily-manipulated";

export const BAND_LABELS: Record<Band, string> = {
  clean: "clean",
  "mostly-clean": "mostly clean",
  mixed: "mixed",
  doubtful: "doubtful",
  "heavily-manipulated": "heavily manipulated",
};

export const BAND_COLORS: Record<Band, string> = {
  clean: "#2E6B4E",
  "mostly-clean": "#6E8A3C",
  mixed: "#B08128",
  doubtful: "#A75A2B",
  "heavily-manipulated": "#9C382F",
};

export type EvidenceStrength = "none" | "weak" | "moderate" | "strong";

export interface EvidenceRow {
  signal: string;
  strength: EvidenceStrength;
  detail: string;
  value: number | null;
}

export interface ConfidenceInterval {
  low: number;
  high: number;
}

export interface Report {
  serial: string;
  band: Band;
  claimedRating: number;
  adjustedRating: number;
  totalReviewCount: number;
  excludedReviewCount: number;
  estimatedInorganicShare: number;
  confidence: ConfidenceInterval;
  evidence: EvidenceRow[];
  unavailableSignals: string[];
  generatedAt: number;
}

export interface ReportSummary {
  band: Band | null;
  claimedRating: number | null;
  adjustedRating: number | null;
  estimatedInorganicShare: number | null;
}

function numberAt(value: Record<string, unknown>, key: string): number | null {
  const found = value[key];
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

export function summarizeReport(report: unknown): ReportSummary {
  if (typeof report !== "object" || report === null) {
    return { band: null, claimedRating: null, adjustedRating: null, estimatedInorganicShare: null };
  }
  const value = report as Record<string, unknown>;
  const band = typeof value.band === "string" && value.band in BAND_LABELS
    ? (value.band as Band)
    : null;
  return {
    band,
    claimedRating: numberAt(value, "claimedRating"),
    adjustedRating: numberAt(value, "adjustedRating"),
    estimatedInorganicShare: numberAt(value, "estimatedInorganicShare"),
  };
}

const STRENGTHS: readonly EvidenceStrength[] = ["none", "weak", "moderate", "strong"];

function evidenceRow(value: unknown): EvidenceRow | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.signal !== "string" || typeof row.detail !== "string") {
    return null;
  }
  const strength = STRENGTHS.find((known) => known === row.strength);
  if (strength === undefined) {
    return null;
  }
  return { signal: row.signal, strength, detail: row.detail, value: numberAt(row, "value") };
}

// a report read back from storage was written by an older build, so nothing is assumed
export function parseStoredReport(value: unknown): Report | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const stored = value as Record<string, unknown>;
  const summary = summarizeReport(value);
  const confidence = stored.confidence as Record<string, unknown> | undefined;
  const low = confidence === undefined ? null : numberAt(confidence, "low");
  const high = confidence === undefined ? null : numberAt(confidence, "high");
  const total = numberAt(stored, "totalReviewCount");
  const excluded = numberAt(stored, "excludedReviewCount");
  const generatedAt = numberAt(stored, "generatedAt");
  if (
    summary.band === null ||
    summary.claimedRating === null ||
    summary.adjustedRating === null ||
    summary.estimatedInorganicShare === null ||
    low === null ||
    high === null ||
    total === null ||
    excluded === null ||
    generatedAt === null ||
    !Array.isArray(stored.evidence)
  ) {
    return null;
  }
  const evidence = stored.evidence.map(evidenceRow).filter((row): row is EvidenceRow => row !== null);
  const unavailable = Array.isArray(stored.unavailableSignals)
    ? stored.unavailableSignals.filter((signal): signal is string => typeof signal === "string")
    : [];
  return {
    serial: typeof stored.serial === "string" ? stored.serial : "",
    band: summary.band,
    claimedRating: summary.claimedRating,
    adjustedRating: summary.adjustedRating,
    totalReviewCount: total,
    excludedReviewCount: excluded,
    estimatedInorganicShare: summary.estimatedInorganicShare,
    confidence: { low, high },
    evidence,
    unavailableSignals: unavailable,
    generatedAt,
  };
}

const SERIAL_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function generateSerial(seed: string, generatedAt: number): string {
  const hash = fnv1a32(`${seed}:${generatedAt}`);
  const digits = toBase(hash, SERIAL_ALPHABET, 8);
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function toBase(value: number, alphabet: string, length: number): string {
  let remaining = value;
  let result = "";
  for (let i = 0; i < length; i++) {
    result = alphabet[remaining % alphabet.length] + result;
    remaining = Math.floor(remaining / alphabet.length);
  }
  return result;
}
