import { Window } from "happy-dom";
import { BUNDLED_AMAZON_RULES } from "../extract/bundledRules";
import { extractFull, extractOnce } from "./extractOnce";

// reads a page's html on stdin and writes one json object on stdout, so the python side
// (research/verdict_research/) can ask the shipped extractor what it finds without owning a second
// copy of it. two consumers, two shapes: the canary wants counts off a live page, the corpus
// builder wants the reviews themselves off a saved one.
//
// nothing here fetches. The url is passed in only so the extractor can place the page's site and
// locale, exactly as the content script does from location.href. Keeping the fetch on the python
// side keeps every network decision, the pacing and the user agent, in one place.
//
// counts are the default and --reviews is the opt in, so nothing that only asked for a health
// number ever has review text passing through it.

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
  const result = withReviews
    ? extractFull(root, url, BUNDLED_AMAZON_RULES)
    : extractOnce(root, url, BUNDLED_AMAZON_RULES);
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
