import { Window } from "happy-dom";
import { BUNDLED_AMAZON_RULES } from "../extract/bundledRules";
import { extractOnce } from "./extractOnce";

// reads a page's html on stdin and writes one json object on stdout, so the python canary job
// (research/verdict_research/canary/) can ask the shipped extractor what it finds without owning a
// second copy of it.
//
// nothing here fetches. The url is passed in only so the extractor can place the page's site and
// locale, exactly as the content script does from location.href. Keeping the fetch on the python
// side keeps every network decision, the pacing and the user agent, in one place.

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<number> {
  const url = process.argv[2];
  if (url === undefined) {
    process.stderr.write("usage: extract <url> < page.html\n");
    return 2;
  }
  const html = await readStdin();
  const window = new Window({ url });
  window.document.documentElement.innerHTML = html;
  const result = extractOnce(
    window.document as unknown as ParentNode,
    url,
    BUNDLED_AMAZON_RULES,
  );
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
