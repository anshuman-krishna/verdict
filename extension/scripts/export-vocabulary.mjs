#!/usr/bin/env node

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
