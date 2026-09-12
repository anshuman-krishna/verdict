import { BAND_LABELS, type Report, type ReportProvenance } from "./report";

export const REPORT_DOCUMENT_VERSION = 1;

export interface ReportDocument {
  documentVersion: number;
  exportedAt: number;
  title: string;
  report: Report;
}

export function reportDocument(report: Report, title: string, exportedAt: number): ReportDocument {
  return { documentVersion: REPORT_DOCUMENT_VERSION, exportedAt, title, report };
}

export function reportDocumentJson(report: Report, title: string, exportedAt: number): string {
  return JSON.stringify(reportDocument(report, title, exportedAt), null, 2);
}

// a serial with nothing to hang it on is not a filename anyone can find again
export function reportFilename(report: Report, extension: string): string {
  const serial = report.serial === "" ? "unserialled" : report.serial.toLowerCase();
  return `verdict-report-${serial}.${extension}`;
}

function stamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function percent(share: number): number {
  return Math.round(share * 100);
}

function figure(value: number | null): string {
  return value === null ? "not recorded" : String(value);
}

export function provenanceLines(provenance: ReportProvenance | undefined): string[] {
  if (provenance === undefined) {
    // an older build did not record it, and guessing would be worse than saying so
    return ["Not recorded. This check was saved before Verdict recorded what produced a report."];
  }
  const trained = provenance.modelTrainedAt === null
    ? "not recorded"
    : stamp(provenance.modelTrainedAt);
  return [
    `Verdict version: ${provenance.extensionVersion}`,
    `Read with: ${provenance.rulesSite} rules version ${figure(provenance.rulesVersion)}`,
    `Scored with: model ${provenance.modelDigest ?? "not recorded"}, trained ${trained}`,
    `Signals weighed: ${provenance.signals.length === 0 ? "none recorded" : provenance.signals.join(", ")}`,
  ];
}

const DISPUTE_LINE =
  "If you believe this is wrong, send this document to verdict.tools/sellers and it will be run again, signal by signal.";

// DESIGN.md section 10: statistical, never accusatory, and every number carries a sentence
export function reportAsText(report: Report, title: string, exportedAt: number): string {
  const kept = report.totalReviewCount - report.excludedReviewCount;
  const lines: string[] = [
    "VERDICT REPORT",
    report.serial === "" ? "" : `Serial: ${report.serial}`,
    `Listing: ${title}`,
    `Checked: ${stamp(report.generatedAt)}`,
    `Exported: ${stamp(exportedAt)}`,
    "",
    `Reading: ${BAND_LABELS[report.band]}`,
    `Claimed rating: ${report.claimedRating.toFixed(1)}`,
    `Adjusted rating: ${report.adjustedRating.toFixed(1)}`,
    `Reviews read: ${report.totalReviewCount.toLocaleString()}`,
    `Reviews kept: ${kept.toLocaleString()}`,
    `Reviews excluded: ${report.excludedReviewCount.toLocaleString()}`,
    `Estimated share arriving outside the organic pattern: ${percent(report.estimatedInorganicShare)} percent`,
    `Estimate range: ${percent(report.confidence.low)} to ${percent(report.confidence.high)} percent`,
    "",
    "EVIDENCE",
  ];

  if (report.evidence.length === 0) {
    lines.push("No signals were recorded for this check.");
  }
  for (const row of report.evidence) {
    lines.push(`${row.signal}: ${row.strength}`);
    lines.push(`  ${row.detail}`);
    lines.push(`  measured: ${row.value === null ? "not available" : row.value}`);
  }

  if (report.unavailableSignals.length > 0) {
    lines.push("", "COULD NOT BE READ", ...report.unavailableSignals.map((signal) => `${signal}`));
  }

  lines.push("", "HOW THIS WAS PRODUCED", ...provenanceLines(report.provenance));
  lines.push("", DISPUTE_LINE);

  return `${lines.filter((line, index) => line !== "" || index > 0).join("\n")}\n`;
}
