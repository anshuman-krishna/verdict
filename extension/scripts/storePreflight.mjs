import { BUNDLE_BUDGET_BYTES } from "./releaseManifest.mjs";

export const PERMISSION_REASONS = {
  alarms:
    "background.ts checks the graph contribution queue periodically, and an mv3 " +
    "service worker is killed freely, which a setInterval does not survive and a " +
    "registered alarm does",
  storage:
    "chrome.storage.sync for preferences only, SPEC.md section 10's 'prefs mirrored " +
    "to chrome.storage.sync where it makes sense'. Reviews and history go to " +
    "IndexedDB, never here",
};

export const UNGRANTED_HOSTS = {
  "verdict.tools":
    "the site itself: the once a day rules fetch (a static signed file, PRIVACY.md " +
    "section 3) and the page the browser opens on uninstall (PRIVACY.md section 6). " +
    "Both are plain navigations or same file fetches, neither needs a host permission",
  localhost: "the development site, matched by externally_connectable and the presence script in development builds only",
};

const REMOTE_CODE_PATTERNS = [
  { pattern: /\beval\s*\(/, name: "eval(" },
  { pattern: /\bnew\s+Function\s*\(/, name: "new Function(" },
  { pattern: /\bdocument\s*\.\s*write\s*\(/, name: "document.write(" },
  { pattern: /<script[^>]+src\s*=\s*["']https?:/i, name: "a remote <script src>" },
];

// a content script shares the page's origin for these, so what it stores, the seller reads
const PAGE_STORAGE_PATTERNS = [
  { pattern: /\bindexedDB\b/, name: "indexedDB" },
  { pattern: /\blocalStorage\b/, name: "localStorage" },
  { pattern: /\bsessionStorage\b/, name: "sessionStorage" },
  { pattern: /document\s*\.\s*cookie\b/, name: "document.cookie" },
];

const HOST_PATTERN = /https?:\/\/([a-z0-9.*-]+\.[a-z]{2,}|localhost)(?::\d+)?/gi;

export function hostsIn(text) {
  const hosts = new Set();
  for (const match of text.matchAll(HOST_PATTERN)) {
    hosts.add(match[1].toLowerCase());
  }
  return hosts;
}

export function declaredHosts(manifest) {
  const patterns = [
    ...(manifest.host_permissions ?? []),
    ...(manifest.optional_host_permissions ?? []),
    ...(manifest.externally_connectable?.matches ?? []),
    ...(manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []),
  ];
  const hosts = new Set();
  for (const pattern of patterns) {
    for (const host of hostsIn(pattern)) {
      hosts.add(host);
    }
  }
  return hosts;
}

function covers(declared, host) {
  if (declared === host) {
    return true;
  }
  if (!declared.startsWith("*.")) {
    return false;
  }
  const suffix = declared.slice(1);
  return host.endsWith(suffix) && host.slice(0, -suffix.length).split(".").length === 1;
}

export function permissionProblems(manifest) {
  const problems = [];
  const declared = manifest.permissions ?? [];
  for (const permission of declared) {
    if (!(permission in PERMISSION_REASONS)) {
      problems.push(
        `the manifest asks for "${permission}" and nothing in this file says why. ` +
          "A permission a reviewer cannot see a reason for is one they refuse",
      );
    }
  }
  for (const permission of Object.keys(PERMISSION_REASONS)) {
    if (!declared.includes(permission)) {
      problems.push(
        `"${permission}" is justified here but the manifest does not ask for it, ` +
          "so this list has drifted from what actually ships",
      );
    }
  }
  return problems;
}

export function breadthProblems(manifest) {
  const problems = [];
  const all = [...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])];
  for (const pattern of all) {
    if (pattern === "<all_urls>" || pattern.startsWith("*://*/") || pattern === "https://*/*") {
      problems.push(`"${pattern}" grants every site, which no part of this needs`);
    }
  }
  return problems;
}

export function remoteCodeProblems(files) {
  const problems = [];
  for (const { path, text } of files) {
    for (const { pattern, name } of REMOTE_CODE_PATTERNS) {
      if (pattern.test(text)) {
        problems.push(
          `${path} contains ${name}. Manifest v3 forbids remote code and the store enforces it`,
        );
      }
    }
  }
  return problems;
}

export function pageStorageProblems(files) {
  const problems = [];
  for (const { path, text } of files) {
    if (!path.startsWith("content-scripts/")) {
      continue;
    }
    for (const { pattern, name } of PAGE_STORAGE_PATTERNS) {
      if (pattern.test(text)) {
        problems.push(
          `${path} uses ${name}, which in a content script belongs to the storefront, not to ` +
            "us. Anything kept there is readable by the seller and invisible to the popup",
        );
      }
    }
  }
  return problems;
}

export function hostProblems(manifest, files) {
  const granted = declaredHosts(manifest);
  const problems = [];
  for (const { path, text } of files) {
    for (const host of hostsIn(text)) {
      if (host in UNGRANTED_HOSTS) {
        continue;
      }
      if (![...granted].some((declared) => covers(declared, host))) {
        problems.push(
          `${path} names ${host}, which the manifest does not declare and this file ` +
            "does not explain. Undeclared data collection is what gets an extension removed",
        );
      }
    }
  }
  return [...new Set(problems)];
}

function modelSlots(artifact) {
  const slots = [["local", artifact]];
  if (artifact.reviewerGraph !== undefined && artifact.reviewerGraph !== null) {
    slots.push(["reviewer graph", artifact.reviewerGraph]);
  }
  return slots;
}

export function modelProblems(artifact) {
  if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) {
    return ["model.json is not an artifact, so the build ships no scorer at all"];
  }
  if (artifact.present !== true) {
    return [];
  }
  const problems = [];
  for (const [slot, model] of modelSlots(artifact)) {
    const quantiles = model?.featureQuantiles ?? {};
    const uncovered = Object.keys(model?.coefficients ?? {}).filter(
      (key) => !Array.isArray(quantiles[key]) || quantiles[key].length === 0,
    );
    if (uncovered.length > 0) {
      problems.push(
        `the ${slot} model carries no quantile sketch for ${uncovered.join(", ")}, so a page ` +
          "missing that signal gets no report at all rather than a wider one",
      );
    }
  }
  return problems;
}

// a platform whose rules are still being written reads nothing, so a bundle that matches one
// is asking a reviewer for a host it cannot justify
export function draftPlatformProblems(manifest, sites) {
  const matched = new Set(
    (manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []),
  );
  const problems = [];
  for (const site of sites) {
    if (site.status !== "draft") {
      continue;
    }
    const prefix = site.pathPrefix ?? "";
    for (const locale of Object.values(site.locales)) {
      const pattern = `https://${locale.host}${prefix}/*`;
      if (matched.has(pattern)) {
        problems.push(
          `the manifest matches ${pattern} for ${site.id}, which the registry still calls a ` +
            "draft. A build that reads a platform it has no rules for shows a reader nothing",
        );
      }
    }
  }
  return problems;
}

// half of SPEC.md section 14's bundle budget, so a word vector table can never be the reason
// an install is refused. the share itself is a shipping decision, not a build one
export const LEXICON_BUDGET_BYTES = BUNDLE_BUDGET_BYTES / 2;

const LEXICON_MAGIC = "VLEX";
const LEXICON_HEADER_BYTES = 20;

export function lexiconProblems(artifact, budgetBytes = LEXICON_BUDGET_BYTES) {
  if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) {
    return ["lexicon.json is not an artifact, so the build cannot say what embeds its text"];
  }
  if (artifact.present !== true) {
    return [];
  }
  if (typeof artifact.identity !== "string" || artifact.identity.length === 0) {
    return ["the bundled word vector table names no identity, so no report can say what read it"];
  }
  if (typeof artifact.bytes !== "string") {
    return ["the bundled word vector table carries no bytes"];
  }

  const problems = [];
  const encoded = JSON.stringify(artifact).length;
  if (encoded > budgetBytes) {
    problems.push(
      `the bundled word vector table is ${encoded} bytes of the ${budgetBytes} it may take, ` +
        "and a bundle that large is one a reviewer opens slowly and a reader downloads twice",
    );
  }

  const bytes = Buffer.from(artifact.bytes, "base64");
  if (bytes.length < LEXICON_HEADER_BYTES || bytes.subarray(0, 4).toString() !== LEXICON_MAGIC) {
    problems.push("the bundled word vector table is not a table, so text would score unembedded");
    return problems;
  }
  const dimensions = bytes.readUInt16LE(6);
  const tokenCount = bytes.readUInt32LE(8);
  const tokenBytes = bytes.readUInt32LE(16);
  const expected = LEXICON_HEADER_BYTES + tokenBytes + tokenCount * dimensions;
  if (bytes.length !== expected) {
    problems.push(
      `the bundled word vector table says it is ${expected} bytes and is ${bytes.length}, ` +
        "so it would be dropped at run time and every listing would read as undrifted",
    );
  }
  return problems;
}

export function preflightProblems(manifest, files, sites = []) {
  return [
    ...permissionProblems(manifest),
    ...breadthProblems(manifest),
    ...remoteCodeProblems(files),
    ...pageStorageProblems(files),
    ...hostProblems(manifest, files),
    ...draftPlatformProblems(manifest, sites),
  ];
}
