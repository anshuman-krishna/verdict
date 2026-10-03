// SITE.md build notes, checked against the built site rather than remembered
export const HOME_BUDGET_BYTES = 150_000;
export const BRIDGE_PAGES = ["check/index.html", "history/index.html"];

// what a browser fetches on its own, as opposed to a link somebody follows
const LOADING_TAG = /<(script|img|iframe|source|link)\b[^>]*>/gi;
const LINK_LOADS = /\brel="(?:stylesheet|preload|modulepreload)"/i;
const ATTRIBUTE = /\b(?:src|href)="([^"]+)"/i;
const CSS_URL = /url\(\s*['"]?([^'")]+)/gi;
const CSS_IMPORT = /@import\s+['"]([^'"]+)/gi;

const SCRIPT_TAG = /<script\b([^>]*)>/gi;
// json-ld is data, the policy never runs it
const DATA_BLOCK = /\btype="application\/(?:ld\+)?json"/i;

function inlineScripts(html) {
  return [...html.matchAll(SCRIPT_TAG)].filter(
    ([, attributes]) => !/\bsrc=/i.test(attributes) && !DATA_BLOCK.test(attributes),
  );
}

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

function stylesheetUrls(css, from) {
  const urls = [...css.matchAll(CSS_URL), ...css.matchAll(CSS_IMPORT)]
    .map(([, url]) => url)
    .filter((url) => !url.startsWith("data:"));
  return urls.map((url) => (isOffSite(url) ? url : new URL(url, `https://site${from}`).pathname));
}

// an external stylesheet loads what it names, so a font cdn could otherwise hide in one
export function pageLoads(html, readText = () => null) {
  const loads = [...loadedUrls(html)];
  const seen = new Set();
  for (let index = 0; index < loads.length; index += 1) {
    const url = loads[index];
    if (isOffSite(url) || !/\.css(?:[?#]|$)/i.test(url) || seen.has(url)) {
      continue;
    }
    seen.add(url);
    const css = readText(url);
    if (css !== null) {
      loads.push(...stylesheetUrls(css, url.split(/[?#]/)[0]));
    }
  }
  return loads;
}

export function homeWeight(html, sizeOf, readText = () => null) {
  const assets = new Set(pageLoads(html, readText).filter((url) => !isOffSite(url)));
  let total = new TextEncoder().encode(html).length;
  for (const asset of assets) {
    total += sizeOf(asset) ?? 0;
  }
  return total;
}

export function siteProblems(pages, sizeOf, readText = () => null) {
  const problems = [];
  for (const { path, html } of pages) {
    for (const url of pageLoads(html, readText).filter(isOffSite)) {
      problems.push(`${path} loads ${url} from another origin, and SITE.md allows no third party`);
    }
    if (inlineScripts(html).length > 0) {
      problems.push(`${path} runs an inline script, which script-src 'self' refuses, so it must be a file`);
    }
  }
  const home = pages.find((page) => page.path === "index.html");
  if (home === undefined) {
    problems.push("no index.html, so the home page budget was never measured");
  } else {
    const weight = homeWeight(home.html, sizeOf, readText);
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

// netlify and cloudflare pages both read this format, a path then indented headers
function parseHeaders(text) {
  const rules = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }
    if (!/^\s/.test(line)) {
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }
    const colon = line.indexOf(":");
    if (current !== null && colon > 0) {
      current.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
  }
  return rules;
}

function directive(policy, name) {
  const found = policy
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key.toLowerCase() === name);
  return found?.slice(1).join(" ") ?? null;
}

const REQUIRED_PAGE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function headerProblems(text) {
  if (text === null) {
    return ["no _headers in the build, so the host serves the site with none of them"];
  }
  const rules = parseHeaders(text);
  const pages = rules.get("/*") ?? new Map();
  const problems = [];
  const policy = pages.get("content-security-policy") ?? "";
  if (directive(policy, "frame-ancestors") !== "'none'") {
    problems.push("/* lets another site frame the pages, frame-ancestors must be 'none'");
  }
  if ((directive(policy, "script-src") ?? directive(policy, "default-src")) !== "'self'") {
    problems.push("/* lets scripts run from somewhere other than the site, script-src must be 'self'");
  }
  for (const [name, value] of Object.entries(REQUIRED_PAGE_HEADERS)) {
    if (pages.get(name) !== value) {
      problems.push(`/* is missing ${name}: ${value}`);
    }
  }
  if (rules.get("/rules/*")?.get("access-control-allow-origin") !== "*") {
    problems.push("/rules/* has no access-control-allow-origin, so every install keeps its bundled rules");
  }
  return problems;
}
