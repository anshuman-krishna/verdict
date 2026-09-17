#!/usr/bin/env node

import { printable, problems, report, stubFor } from "./translationCoverage.mjs";

const argv = process.argv.slice(2);
const stubAt = argv.indexOf("--stub");

if (stubAt !== -1) {
  const language = argv[stubAt + 1];
  if (language === undefined) {
    console.error("usage: translations.mjs [--stub <language>]");
    process.exit(2);
  }
  process.stdout.write(stubFor(language));
} else {
  const rows = report();
  console.log(printable(rows));
  const found = problems(rows);
  if (found.length > 0) {
    console.error(`\n${found.length} problem(s):`);
    for (const problem of found) {
      console.error(`  ${problem}`);
    }
    process.exit(1);
  }
}
