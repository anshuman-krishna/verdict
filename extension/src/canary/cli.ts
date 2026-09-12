import { Window } from "happy-dom";
import { bundledRulesFor, emptyRules } from "../extract/bundledRules";
import { parseProductUrl, siteForHost } from "../extract/sites";
import { extractFull, extractOnce } from "./extractOnce";

// the canary drives whichever storefront the url names, not one named here
function rulesForUrl(url: string) {
  let siteId = parseProductUrl(url)?.site ?? null;
  if (siteId === null) {
    try {
      siteId = siteForHost(new URL(url).hostname)?.id ?? null;
    } catch {
      siteId = null;
    }
  }
  return siteId === null ? emptyRules("unknown") : bundledRulesFor(siteId) ?? emptyRules(siteId);
}


async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const withReviews = args.includes("--reviews");
  const url = args.find((arg) => !arg.startsWith("--"));
  if (url === undefined) {
    process.stderr.write("usage: extract [--reviews] <url> < page.html\n");
    return 2;
  }
  const html = await readStdin();
  const window = new Window({ url });
  window.document.documentElement.innerHTML = html;
  const root = window.document as unknown as ParentNode;
  const rules = rulesForUrl(url);
  const result = withReviews
    ? extractFull(root, url, rules)
    : extractOnce(root, url, rules);
  await window.happyDOM.close();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
