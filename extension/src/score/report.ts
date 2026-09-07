// DESIGN.md section 4's band scale. where a vector crosses between bands is anshuman's, not decided
// here: this only shapes a report once a band is assigned

export type Band = "clean" | "mostly-clean" | "mixed" | "doubtful" | "heavily-manipulated";

export const BAND_LABELS: Record<Band, string> = {
  clean: "clean",
  "mostly-clean": "mostly clean",
  mixed: "mixed",
  doubtful: "doubtful",
  "heavily-manipulated": "heavily manipulated",
};

// DESIGN.md section 4, "the band scale", light mode values
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
  // DESIGN.md section 9: "never a raw score with no sentence attached"
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
  generatedAt: number;
}

export interface ReportSummary {
  band: Band | null;
  claimedRating: number | null;
  adjustedRating: number | null;
  // enough for /history to draw a thumbnail without parsing evidence rows out of an unknown report
  estimatedInorganicShare: number | null;
}

// a legacy or malformed report summarises to all nulls rather than crashing a caller. shared by the
// popup and the bridge so the two never disagree on what counts as valid
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

// seed plus generation time, so re-checking renumbers the way a reissued certificate does
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
