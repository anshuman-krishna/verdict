#!/usr/bin/env node
// Writes the band scale and rosette constants the website reads, from the
// extension's own definitions. See scripts/reportVocabulary.mjs for why
// this is generated rather than copied by hand into each page that needs
// it.
//
// Usage:
//   just export-vocabulary
//
// `just check` fails when the committed file no longer matches what the
// extension defines, so changing a band colour and forgetting this is a
// failing build rather than a website that renders last month's palette.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReportVocabulary, serialiseReportVocabulary } from "./reportVocabulary.mjs";

export const VOCABULARY_PATH = resolve(
  import.meta.dirname,
  "..",
  "..",
  "site",
  "src",
  "data",
  "reportVocabulary.json",
);

writeFileSync(VOCABULARY_PATH, serialiseReportVocabulary(buildReportVocabulary()));
console.log(`wrote ${VOCABULARY_PATH}`);
