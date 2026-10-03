import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe.each(["popup", "options"])("the %s page", (page) => {
  const html = read(`../src/entrypoints/${page}/index.html`);

  it("declares a language, so a screen reader picks the right voice", () => {
    expect(html).toMatch(/<html lang="[a-z]{2}">/);
  });

  it("draws into a main landmark", () => {
    expect(html).toContain('<main id="app"></main>');
  });
});
