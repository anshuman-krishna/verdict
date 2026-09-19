import type { MessageId } from "../i18n/messages.ts";
import { isMessageId } from "../i18n/messages.ts";
import { shortDigest } from "./digest.ts";

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

// the sentences a row is made of rather than the sentence it came out as, so a report
// stored in one language can be read back in another
export interface EvidenceMessage {
  id: MessageId;
  // the number that picks a plural form, where the line counts something
  count?: number;
  params?: Record<string, string | number>;
}

export interface EvidenceRow {
  signal: string;
  strength: EvidenceStrength;
  detail: string;
  value: number | null;
  // absent on rows written before this build recorded them
  messages?: EvidenceMessage[];
}

export interface ConfidenceInterval {
  low: number;
  high: number;
}

// SITE.md /sellers promises a disputed report will be re run. that is only
// possible if the report says what read the page and what scored it.
export interface ReportProvenance {
  extensionVersion: string;
  rulesVersion: number;
  rulesSite: string;
  modelTrainedAt: number | null;
  modelDigest: string | null;
  // which category prior scored it, null when the default one did
  priorsKey: string | null;
  // what embedded the review text, null on reports written before this build recorded it
  embedding: string | null;
  signals: string[];
}

export interface Report {
  serial: string;
  band: Band;
  // SPEC.md section 6: the output is a probability, because a probability can be checked.
  // null on reports written before this build recorded it
  probability: number | null;
  claimedRating: number;
  adjustedRating: number;
  totalReviewCount: number;
  excludedReviewCount: number;
  estimatedInorganicShare: number;
  confidence: ConfidenceInterval;
  evidence: EvidenceRow[];
  unavailableSignals: string[];
  // signals the platform structurally does not record, which is not the same as unread
  absentSignals: string[];
  generatedAt: number;
  // absent on reports written before this build recorded it
  provenance?: ReportProvenance;
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
  const messages = evidenceMessages(row.messages);
  return {
    signal: row.signal,
    strength,
    detail: row.detail,
    value: numberAt(row, "value"),
    ...(messages === null ? {} : { messages }),
  };
}

function evidenceMessages(value: unknown): EvidenceMessage[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const built: EvidenceMessage[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    // an id this build does not have would render as nothing, so the stored english stands
    if (typeof record.id !== "string" || !isMessageId(record.id)) {
      return null;
    }
    const count = numberAt(record, "count");
    built.push({
      id: record.id,
      ...(count === null ? {} : { count }),
      ...(typeof record.params === "object" && record.params !== null
        ? { params: record.params as Record<string, string | number> }
        : {}),
    });
  }
  return built.length === 0 ? null : built;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parseProvenance(value: unknown): ReportProvenance | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rulesVersion = numberAt(record, "rulesVersion");
  if (typeof record.extensionVersion !== "string" || typeof record.rulesSite !== "string" || rulesVersion === null) {
    return null;
  }
  return {
    extensionVersion: record.extensionVersion,
    rulesVersion,
    rulesSite: record.rulesSite,
    modelTrainedAt: numberAt(record, "modelTrainedAt"),
    modelDigest: typeof record.modelDigest === "string" ? record.modelDigest : null,
    priorsKey: typeof record.priorsKey === "string" ? record.priorsKey : null,
    embedding: typeof record.embedding === "string" ? record.embedding : null,
    signals: stringList(record.signals),
  };
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
  const unavailable = stringList(stored.unavailableSignals);
  const probability = numberAt(stored, "probability");
  const absent = stringList(stored.absentSignals);
  const provenance = parseProvenance(stored.provenance);
  return {
    serial: typeof stored.serial === "string" ? stored.serial : "",
    band: summary.band,
    probability,
    claimedRating: summary.claimedRating,
    adjustedRating: summary.adjustedRating,
    totalReviewCount: total,
    excludedReviewCount: excluded,
    estimatedInorganicShare: summary.estimatedInorganicShare,
    confidence: { low, high },
    evidence,
    unavailableSignals: unavailable,
    absentSignals: absent,
    generatedAt,
    ...(provenance === null ? {} : { provenance }),
  };
}

export function generateSerial(seed: string, generatedAt: number): string {
  const digits = shortDigest(`${seed}:${generatedAt}`);
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
}
