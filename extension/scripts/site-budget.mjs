#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { homeWeight, siteProblems } from "./siteBudget.mjs";

const DIST = resolve(import.meta.dirname, "..", "..", "site", "dist");

function htmlPages(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return htmlPages(root, path);
    }
    return entry.name.endsWith(".html")
      ? [{ path: relative(root, path), html: readFileSync(path, "utf8") }]
      : [];
  });
}

function sizeUnder(root) {
  return (url) => {
    try {
      return statSync(join(root, url.split(/[?#]/)[0])).size;
    } catch {
      return null;
    }
  };
}

function main() {
  const root = process.argv[2] ?? DIST;
  let pages;
  try {
    pages = htmlPages(root);
  } catch {
    console.error(`site budget: nothing built at ${root}, run npm run build in site first`);
    process.exitCode = 1;
    return;
  }
  const problems = siteProblems(pages, sizeUnder(root));
  if (problems.length > 0) {
    console.error("site budget:");
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  const home = pages.find((page) => page.path === "index.html");
  const weight = home === undefined ? 0 : homeWeight(home.html, sizeUnder(root));
  console.log(`site budget: ${pages.length} pages, nothing third party, home page ${weight} bytes`);
}

main();
