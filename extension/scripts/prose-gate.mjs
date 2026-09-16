#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isScanned, proseProblems } from "./proseGate.mjs";

const REPOSITORY = resolve(import.meta.dirname, "..", "..");

function trackedFiles(root) {
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return listed.split("\0").filter((path) => path !== "" && isScanned(path));
}

function read(root, path) {
  try {
    return { path, text: readFileSync(join(root, path), "utf8") };
  } catch {
    // a file git lists but this cannot read as text is not prose
    return null;
  }
}

function main() {
  const root = process.argv[2] ?? REPOSITORY;
  const files = trackedFiles(root)
    .map((path) => read(root, path))
    .filter((file) => file !== null);

  const problems = proseProblems(files);
  if (problems.length > 0) {
    console.error("prose gate:");
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`prose gate: ${files.length} files, no em dashes and nothing accusatory`);
}

main();
