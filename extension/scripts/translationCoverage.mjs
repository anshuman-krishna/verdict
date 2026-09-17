import { allCatalogues } from "../src/i18n/catalogues.ts";
import { coverageReport, formatCoverage } from "../src/i18n/coverage.ts";
import { ENGLISH, MESSAGE_IDS, isPlural } from "../src/i18n/messages.ts";

export function report(catalogues = allCatalogues()) {
  return coverageReport(catalogues);
}

export function printable(rows) {
  return formatCoverage(rows);
}

export function problems(rows) {
  return rows.flatMap((row) => row.problems.map((problem) => `${row.language}: ${problem}`));
}

function categoriesFor(language) {
  try {
    return [...new Intl.PluralRules(language).resolvedOptions().pluralCategories];
  } catch {
    return ["other"];
  }
}

function comment(message) {
  const forms = typeof message === "string" ? [message] : Object.values(message);
  return forms.join(" / ").replaceAll("*/", "* /");
}

// a language starts as a file somebody has to fill in, so hand them the file
export function stubFor(language, catalogues = allCatalogues()) {
  const existing = catalogues[language] ?? {};
  const categories = categoriesFor(language);
  const lines = [
    `import type { Catalogue } from "./messages.ts";`,
    ``,
    `// every line is english until somebody writes it. an empty string is not a`,
    `// translation: delete the entry instead and the english below it stands.`,
    `export const ${language.toUpperCase().replaceAll("-", "_")}: Catalogue = {`,
  ];
  for (const id of MESSAGE_IDS) {
    if (Object.hasOwn(existing, id)) {
      continue;
    }
    const english = ENGLISH[id];
    lines.push(`  // ${comment(english)}`);
    if (isPlural(english)) {
      const forms = categories.map((category) => `${category}: ""`).join(", ");
      lines.push(`  ${JSON.stringify(id)}: { ${forms} },`);
    } else {
      lines.push(`  ${JSON.stringify(id)}: "",`);
    }
  }
  lines.push(`};`, ``);
  return lines.join("\n");
}
