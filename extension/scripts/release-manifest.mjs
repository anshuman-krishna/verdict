#!/usr/bin/env node
// writes release-manifest.json from a build in .output, and checks a build against an earlier one.
// what backs /install's promise that a release lists its commit and the sha256 of its zip.
//
// usage:
//   just ext zip                                build and zip both targets first
//   node scripts/release-manifest.mjs           write .output/release-manifest.json
//   node scripts/release-manifest.mjs --verify  check .output against that document
//   node scripts/release-manifest.mjs --verify --manifest path/to/release-manifest.json
//
// --verify never writes: for a rebuild of the same commit, or for anyone checking a download

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseManifest, verifyReleaseManifest } from "./releaseManifest.mjs";

const extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(extensionDir, ".output");
// never committed: it names the commit it was built from, so a copy in the tree is always stale
const DEFAULT_MANIFEST_PATH = join(outputDir, "release-manifest.json");

function sha256OfFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function directoryBytes(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? directoryBytes(child) : statSync(child).size;
  }
  return total;
}

// the directory is what the browser installs, so it is what the budget measures; the zip is what is
// uploaded, so it is what is hashed. an ambiguous .output is refused: a stale zip picked silently
// would put a hash in the manifest belonging to a different build
function exactlyOneZip(zips, suffix, target) {
  const matches = zips.filter((entry) => entry.name.endsWith(suffix));
  if (matches.length === 0) {
    throw new Error(`built ${target} but found no ${suffix} beside it, run: just ext zip`);
  }
  if (matches.length > 1) {
    const names = matches.map((entry) => entry.name).join(", ");
    throw new Error(`more than one ${suffix} in .output (${names}), run: just ext zip`);
  }
  return matches[0];
}

function collectArtifacts() {
  const entries = readdirSync(outputDir, { withFileTypes: true });
  const zips = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".zip"));
  const artifacts = [];

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const browser = entry.name.split("-mv")[0];
    const zip = exactlyOneZip(zips, `-${browser}.zip`, entry.name);
    artifacts.push({
      target: entry.name,
      file: zip.name,
      sha256: sha256OfFile(join(outputDir, zip.name)),
      zipBytes: statSync(join(outputDir, zip.name)).size,
      unpackedBytes: directoryBytes(join(outputDir, entry.name)),
    });
  }

  // the sources zip addons.mozilla.org asks for alongside a minified firefox build: a release
  // artifact worth hashing, never an installed bundle, hence no unpacked size and no budget.
  const sources = zips.some((entry) => entry.name.endsWith("-sources.zip"))
    ? exactlyOneZip(zips, "-sources.zip", "sources")
    : undefined;
  if (sources !== undefined) {
    artifacts.push({
      target: "sources",
      file: sources.name,
      sha256: sha256OfFile(join(outputDir, sources.name)),
      zipBytes: statSync(join(outputDir, sources.name)).size,
      unpackedBytes: null,
    });
  }

  if (artifacts.length === 0) {
    throw new Error("nothing in .output to record, run: just ext zip");
  }
  return artifacts;
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: extensionDir, encoding: "utf8" }).trim();
}

function manifestPathFromArgv(argv) {
  const flag = argv.indexOf("--manifest");
  if (flag === -1) {
    return DEFAULT_MANIFEST_PATH;
  }
  const value = argv[flag + 1];
  if (value === undefined) {
    throw new Error("--manifest needs a path");
  }
  return resolve(value);
}

function main() {
  const verifyOnly = process.argv.includes("--verify");
  const manifestPath = manifestPathFromArgv(process.argv);
  const artifacts = collectArtifacts();
  const version = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8")).version;

  if (verifyOnly) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const problems = verifyReleaseManifest(manifest, artifacts);
    if (problems.length > 0) {
      console.error("release manifest does not match .output:");
      for (const problem of problems) {
        console.error(`  ${problem}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log(`release manifest matches ${artifacts.length} built artifacts at ${manifest.commit}`);
    return;
  }

  // buildReleaseManifest is what enforces the budget, so a build over
  // SPEC.md section 14's cap throws here rather than being written down.
  const manifest = buildReleaseManifest({ version, commit: currentCommit(), artifacts });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const artifact of manifest.artifacts) {
    console.log(`${artifact.file}  ${artifact.sha256}`);
  }
  console.log(`wrote ${manifestPath} for ${manifest.version} at ${manifest.commit}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
