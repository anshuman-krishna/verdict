import { allCatalogues } from "./catalogues.ts";
import {
  ENGLISH,
  isPlural,
  MESSAGE_IDS,
  placeholdersIn,
  type Catalogue,
  type MessageId,
} from "./messages.ts";

export interface LanguageCoverage {
  language: string;
  translated: number;
  total: number;
  missing: MessageId[];
  // a translation that renders "{count}" at somebody, or has no form for a number
  problems: string[];
}

function pluralCategories(language: string): string[] {
  try {
    return [...new Intl.PluralRules(language).resolvedOptions().pluralCategories];
  } catch {
    return ["other"];
  }
}

export function coverageFor(language: string, catalogue: Catalogue): LanguageCoverage {
  const required = pluralCategories(language);
  const missing: MessageId[] = [];
  const problems: string[] = [];

  for (const id of Object.keys(catalogue)) {
    if (!MESSAGE_IDS.includes(id as MessageId)) {
      problems.push(`${id} is not a message this build has`);
    }
  }

  for (const id of MESSAGE_IDS) {
    const translated = catalogue[id];
    if (translated === undefined) {
      missing.push(id);
      continue;
    }
    const wanted = placeholdersIn(ENGLISH[id]).join(", ");
    const given = placeholdersIn(translated).join(", ");
    if (wanted !== given) {
      problems.push(`${id} interpolates ${given || "nothing"}, english interpolates ${wanted || "nothing"}`);
    }
    if (isPlural(ENGLISH[id])) {
      if (!isPlural(translated)) {
        problems.push(`${id} counts something, so it needs a form per plural category`);
        continue;
      }
      const absent = required.filter((category) => !Object.hasOwn(translated, category));
      if (absent.length > 0) {
        problems.push(`${id} has no ${absent.join(", ")} form, which ${language} needs`);
      }
    }
  }

  return {
    language,
    translated: MESSAGE_IDS.length - missing.length,
    total: MESSAGE_IDS.length,
    missing,
    problems,
  };
}

export function coverageReport(
  catalogues: Record<string, Catalogue> = allCatalogues(),
): LanguageCoverage[] {
  return Object.entries(catalogues)
    .map(([language, catalogue]) => coverageFor(language, catalogue))
    .sort((a, b) => a.language.localeCompare(b.language));
}

export function formatCoverage(rows: readonly LanguageCoverage[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    const share = Math.round((row.translated / row.total) * 100);
    lines.push(`${row.language}: ${row.translated} of ${row.total} lines, ${share} percent`);
    for (const problem of row.problems) {
      lines.push(`  problem: ${problem}`);
    }
    if (row.missing.length > 0 && row.missing.length <= 10) {
      lines.push(`  missing: ${row.missing.join(", ")}`);
    }
  }
  return lines.join("\n");
}
