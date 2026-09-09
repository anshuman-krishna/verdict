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
  localhost: "the development site, matched by externally_connectable and the presence script",
};

const REMOTE_CODE_PATTERNS = [
  { pattern: /\beval\s*\(/, name: "eval(" },
  { pattern: /\bnew\s+Function\s*\(/, name: "new Function(" },
  { pattern: /\bdocument\s*\.\s*write\s*\(/, name: "document.write(" },
  { pattern: /<script[^>]+src\s*=\s*["']https?:/i, name: "a remote <script src>" },
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

export function preflightProblems(manifest, files) {
  return [
    ...permissionProblems(manifest),
    ...breadthProblems(manifest),
    ...remoteCodeProblems(files),
    ...hostProblems(manifest, files),
  ];
}
