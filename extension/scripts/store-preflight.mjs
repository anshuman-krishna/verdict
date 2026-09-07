#!/usr/bin/env node
// store removal is the main operational risk for this project, not lawsuits.
// this reads a built bundle and refuses it if it would earn one.
//
// usage:
//   just preflight
//   node scripts/store-preflight.mjs [--target chrome-mv3] [--output .output]
//
// Reads the built output rather than the source, because the bundle is what
// gets reviewed and what ships. Run after `just ext build`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { preflightProblems } from "./storePreflight.mjs";

const DEFAULT_OUTPUT = resolve(import.meta.dirname, "..", ".output");
const SCANNED_EXTENSIONS = [".js", ".mjs", ".html", ".css", ".json"];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key === undefined || value === undefined) {
      throw new Error("usage: store-preflight.mjs [--target <dir>] [--output <dir>]");
    }
    args[key] = value;
  }
  return args;
}

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path));
    } else if (SCANNED_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = args.output ?? DEFAULT_OUTPUT;
  const target = args.target ?? "chrome-mv3";
  const bundle = join(output, target);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8"));
  } catch {
    console.error(`no manifest at ${bundle}, run \`just ext build\` first`);
    process.exitCode = 1;
    return;
  }

  const files = walk(bundle)
    // the manifest is the thing being checked against, not a thing to
    // check: its own declared hosts are not evidence of anything.
    .filter((path) => path !== join(bundle, "manifest.json"))
    .map((path) => ({ path: relative(bundle, path), text: readFileSync(path, "utf8") }));

  const problems = preflightProblems(manifest, files);
  if (problems.length > 0) {
    console.error(`${target} is not shippable:`);
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`${target}: ${files.length} files, nothing that would get it removed`);
}

main();
