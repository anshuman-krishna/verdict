#!/usr/bin/env node

import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  EXTENSION_PAGES,
  extensionPageProblems,
  reopenProblems,
  SITE_PAGE,
  SITE_URL,
  siteProblems,
  STOREFRONT_URL,
  storefrontPage,
  storefrontProblems,
} from "./browserSmoke.mjs";

const EXTENSION = resolve(import.meta.dirname, "..", ".output", "chrome-mv3");
const SETTLE_MS = 3_000;

async function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function mountedOn(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("verdict-panel, verdict-notice")].map((element) =>
      element.tagName.toLowerCase()
    )
  );
}

// what the popup sends, sent from the worker, since a popup opened by a script is its own active tab
function askEveryTab(worker, type) {
  return worker.evaluate(async (messageType) => {
    const replies = await Promise.all(
      (await chrome.tabs.query({})).map((tab) =>
        chrome.tabs.sendMessage(tab.id, { type: messageType }).catch(() => null)
      ),
    );
    return replies.find((reply) => reply !== null && reply !== undefined) ?? null;
  }, type);
}

async function readStorefront(context, worker) {
  const page = await context.newPage();
  const errors = await watchErrors(page);
  await page.goto(STOREFRONT_URL);
  await page.waitForTimeout(SETTLE_MS);
  const mounted = await mountedOn(page);
  const problems = storefrontProblems({ errors, mounted });
  if (mounted.length === 1) {
    await page.evaluate(() =>
      document.querySelector("verdict-panel, verdict-notice")?.dispatchEvent(
        new CustomEvent("verdict:close", { bubbles: true, composed: true }),
      )
    );
    const status = await askEveryTab(worker, "verdict:panel:status");
    const reopened = await askEveryTab(worker, "verdict:panel:reopen");
    const mountedAfter = (await mountedOn(page)).length;
    problems.push(...reopenProblems({ status, reopened, mountedAfter }));
  }
  await page.close();
  return problems;
}

async function readSite(context) {
  const page = await context.newPage();
  const errors = await watchErrors(page);
  await page.goto(SITE_URL);
  const relay = await page
    .waitForFunction(() => document.documentElement.getAttribute("data-verdict-relay"), null, {
      timeout: SETTLE_MS,
    })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  await page.close();
  return siteProblems({ errors, relay });
}

async function readExtensionPage(context, extensionId, name) {
  const page = await context.newPage();
  const errors = await watchErrors(page);
  await page.goto(`chrome-extension://${extensionId}/${name}`);
  await page.waitForLoadState("networkidle");
  const shape = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    mainCount: document.querySelectorAll("main").length,
    headingCount: document.querySelectorAll("h1").length,
  }));
  await page.close();
  return extensionPageProblems(name, { errors, ...shape });
}

async function main() {
  // the full chromium, since the headless shell cannot load an extension
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  try {
    // nothing leaves the machine, every storefront and site request is answered here
    await context.route("https://www.amazon.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: storefrontPage() })
    );
    await context.route("https://verdict.tools/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: SITE_PAGE })
    );
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;

    const problems = [
      ...await readStorefront(context, worker),
      ...await readSite(context),
    ];
    for (const name of EXTENSION_PAGES) {
      problems.push(...await readExtensionPage(context, extensionId, name));
    }

    if (problems.length > 0) {
      console.error("browser smoke:");
      for (const problem of problems) {
        console.error(`  ${problem}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log(
      `browser smoke: storefront, reopening a closed panel, website and ${EXTENSION_PAGES.length} extension pages in chromium`,
    );
  } finally {
    await context.close();
  }
}

await main();
