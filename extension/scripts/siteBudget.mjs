// SITE.md build notes, checked against the built site rather than remembered
export const HOME_BUDGET_BYTES = 150_000;
export const BRIDGE_PAGES = ["check/index.html", "history/index.html"];

// what a browser fetches on its own, as opposed to a link somebody follows
const LOADING_TAG = /<(script|img|iframe|source|link)\b[^>]*>/gi;
const LINK_LOADS = /\brel="(?:stylesheet|preload|modulepreload)"/i;
const ATTRIBUTE = /\b(?:src|href)="([^"]+)"/i;
const CSS_URL = /url\(\s*['"]?([^'")]+)/gi;

function isOffSite(url) {
  return /^(?:[a-z]+:)?\/\//i.test(url);
}

export function loadedUrls(html) {
  const urls = [];
  for (const [tag, name] of html.matchAll(LOADING_TAG)) {
    if (name.toLowerCase() === "link" && !LINK_LOADS.test(tag)) {
      continue;
    }
    const url = ATTRIBUTE.exec(tag)?.[1];
    if (url !== undefined) {
      urls.push(url);
    }
  }
  for (const [, url] of html.matchAll(CSS_URL)) {
    if (!url.startsWith("data:")) {
      urls.push(url);
    }
  }
  return urls;
}

export function homeWeight(html, sizeOf) {
  const assets = new Set(loadedUrls(html).filter((url) => !isOffSite(url)));
  let total = new TextEncoder().encode(html).length;
  for (const asset of assets) {
    total += sizeOf(asset) ?? 0;
  }
  return total;
}

export function siteProblems(pages, sizeOf) {
  const problems = [];
  for (const { path, html } of pages) {
    for (const url of loadedUrls(html).filter(isOffSite)) {
      problems.push(`${path} loads ${url} from another origin, and SITE.md allows no third party`);
    }
  }
  const home = pages.find((page) => page.path === "index.html");
  if (home === undefined) {
    problems.push("no index.html, so the home page budget was never measured");
  } else {
    const weight = homeWeight(home.html, sizeOf);
    if (weight > HOME_BUDGET_BYTES) {
      problems.push(`the home page weighs ${weight} bytes, over the ${HOME_BUDGET_BYTES} SITE.md allows`);
    }
  }
  for (const bridge of BRIDGE_PAGES) {
    const page = pages.find((candidate) => candidate.path === bridge);
    if (page === undefined) {
      problems.push(`${bridge} is missing`);
    } else if (!/<noscript\b/i.test(page.html)) {
      problems.push(`${bridge} talks to the extension and says nothing when javascript is off`);
    }
  }
  return problems;
}
