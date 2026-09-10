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

export function summarizeReport(report: unknown): ReportSummary {
  if (typeof report !== "object" || report === null) {
    return { band: null, claimedRating: null, adjustedRating: null, estimatedInorganicShare: null };
  }
  const value = report as Record<string, unknown>;
  const band = typeof value.band === "string" && value.band in BAND_LABELS
    ? (value.band as Band)
    : null;
  const claimedRating = typeof value.claimedRating === "number" ? value.claimedRating : null;
  const adjustedRating = typeof value.adjustedRating === "number" ? value.adjustedRating : null;
  const estimatedInorganicShare =
    typeof value.estimatedInorganicShare === "number" ? value.estimatedInorganicShare : null;
  return { band, claimedRating, adjustedRating, estimatedInorganicShare };
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
