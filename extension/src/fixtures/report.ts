import type { FixtureResult } from "./harness";

export const REQUIRED_PASS_RATE = 0.95;
export const REQUIRED_LOCALE_COUNT = 4;

export interface LocaleTally {
  locale: string;
  total: number;
  passed: number;
}

export interface CorpusReport {
  total: number;
  passed: number;
  passRate: number | null;
  locales: LocaleTally[];
  meetsPassRate: boolean;
  meetsLocaleCoverage: boolean;
  meetsCriterion: boolean;
  failures: FixtureResult[];
  unexpectedFailures: FixtureResult[];
}

export function buildCorpusReport(results: readonly FixtureResult[]): CorpusReport {
  const tallies = new Map<string, LocaleTally>();
  for (const result of results) {
    const tally = tallies.get(result.locale) ?? { locale: result.locale, total: 0, passed: 0 };
    tally.total += 1;
    if (result.ok) {
      tally.passed += 1;
    }
    tallies.set(result.locale, tally);
  }

  const total = results.length;
  const passed = results.filter((result) => result.ok).length;
  const passRate = total === 0 ? null : passed / total;
  const locales = [...tallies.values()].sort((a, b) => a.locale.localeCompare(b.locale));
  const meetsPassRate = passRate !== null && passRate >= REQUIRED_PASS_RATE;
  const meetsLocaleCoverage = locales.length >= REQUIRED_LOCALE_COUNT;

  return {
    total,
    passed,
    passRate,
    locales,
    meetsPassRate,
    meetsLocaleCoverage,
    meetsCriterion: meetsPassRate && meetsLocaleCoverage,
    failures: results.filter((result) => !result.ok),
    unexpectedFailures: results.filter((result) => !result.ok && result.knownFailure === null),
  };
}

export function formatReport(report: CorpusReport): string {
  const lines: string[] = [];
  if (report.total === 0) {
    lines.push("fixture corpus is empty, so extraction is unmeasured");
    lines.push("see extension/fixtures/README.md for what a fixture is");
    return lines.join("\n");
  }

  const rate = ((report.passRate ?? 0) * 100).toFixed(1);
  lines.push(`${report.passed} of ${report.total} fixtures pass (${rate} percent)`);
  lines.push(
    `locales: ${report.locales.map((tally) => `${tally.locale} ${tally.passed}/${tally.total}`).join(", ")}`,
  );

  for (const failure of report.failures) {
    lines.push("");
    const known = failure.knownFailure;
    lines.push(
      `${failure.name} (${failure.site}.${failure.locale}, ${failure.layout} layout)${known === null ? "" : ` [known: ${known}]`}`,
    );
    lines.push(`  extracted ${failure.extractedReviews} reviews`);
    for (const check of failure.checks) {
      if (check.ok) {
        continue;
      }
      lines.push(`  ${check.field}: expected ${show(check.expected)}, got ${show(check.actual)}`);
      lines.push(`    ${describeStrategies(check)}`);
    }
  }

  lines.push("");
  lines.push(
    report.meetsPassRate
      ? `pass rate meets the ${REQUIRED_PASS_RATE} criterion`
      : `pass rate is under the ${REQUIRED_PASS_RATE} criterion`,
  );
  lines.push(
    report.meetsLocaleCoverage
      ? `${report.locales.length} locales meets the ${REQUIRED_LOCALE_COUNT} locale criterion`
      : `${report.locales.length} locales is under the ${REQUIRED_LOCALE_COUNT} locale criterion`,
  );
  return lines.join("\n");
}

function describeStrategies(check: { strategies: FixtureResult["checks"][number]["strategies"] }): string {
  const strategies = check.strategies;
  if (strategies === null || strategies.length === 0) {
    return "no rule for this field in rules.json";
  }
  return strategies
    .map((step) => `${step.strategy} ${show(step.target)} matched ${step.matched}`)
    .join(", then ");
}

function show(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
