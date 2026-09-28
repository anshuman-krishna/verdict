import { describe, expect, it } from "vitest";
import { HOME_BUDGET_BYTES, homeWeight, loadedUrls, siteProblems } from "./siteBudget.mjs";

const NOSCRIPT = "<noscript><p>needs javascript</p></noscript>";
const sizes = (table) => (url) => table[url] ?? null;

function site(overrides = {}) {
  const pages = {
    "index.html": "<html><body>home</body></html>",
    "check/index.html": `<html>${NOSCRIPT}<script>1</script></html>`,
    "history/index.html": `<html>${NOSCRIPT}<script>1</script></html>`,
    ...overrides,
  };
  return Object.entries(pages)
    .filter(([, html]) => html !== null)
    .map(([path, html]) => ({ path, html }));
}

describe("what a page makes the browser fetch", () => {
  it("counts scripts, images, stylesheets, preloads and css urls", () => {
    const html = `
      <script src="/a.js"></script><img src="/b.png">
      <link rel="stylesheet" href="/c.css"><link rel="preload" href="/d.woff2" as="font">
      <style>@font-face { src: url('/e.woff2') }</style>`;
    expect(loadedUrls(html)).toEqual(["/a.js", "/b.png", "/c.css", "/d.woff2", "/e.woff2"]);
  });

  it("leaves out a link somebody has to follow, and inline data", () => {
    const html = `<a href="https://github.com/x">source</a><link rel="canonical" href="https://x.y/">
      <style>.a { background: url(data:image/png;base64,AAAA) }</style>`;
    expect(loadedUrls(html)).toEqual([]);
  });
});

describe("the SITE.md build notes", () => {
  it("passes a site that keeps to them", () => {
    expect(siteProblems(site(), sizes({}))).toEqual([]);
  });

  it("names a script loaded from another origin, protocol relative included", () => {
    const problems = siteProblems(
      site({ "method/index.html": '<script src="//cdn.example/x.js"></script>' }),
      sizes({}),
    );
    expect(problems).toEqual([
      "method/index.html loads //cdn.example/x.js from another origin, and SITE.md allows no third party",
    ]);
  });

  it("names a font pulled from a font cdn through css", () => {
    const problems = siteProblems(
      site({ "index.html": "<style>@import url('https://fonts.example/css');</style>" }),
      sizes({}),
    );
    expect(problems[0]).toMatch(/^index\.html loads https:\/\/fonts\.example\/css/);
  });

  it("weighs the home page with everything it loads, counted once", () => {
    const html = '<img src="/a.png"><img src="/a.png"><script src="/b.js"></script>';
    expect(homeWeight(html, sizes({ "/a.png": 100, "/b.js": 50 }))).toBe(html.length + 150);
  });

  it("refuses a home page over the budget", () => {
    const problems = siteProblems(
      site({ "index.html": '<img src="/hero.png">' }),
      sizes({ "/hero.png": HOME_BUDGET_BYTES }),
    );
    expect(problems[0]).toMatch(/^the home page weighs \d+ bytes, over the 150000/);
  });

  it("wants a bridge page to say what happens without javascript", () => {
    const problems = siteProblems(site({ "check/index.html": "<script>1</script>" }), sizes({}));
    expect(problems).toEqual([
      "check/index.html talks to the extension and says nothing when javascript is off",
    ]);
  });

  it("notices a page that was never built rather than passing it", () => {
    expect(siteProblems(site({ "history/index.html": null, "index.html": null }), sizes({}))).toEqual([
      "no index.html, so the home page budget was never measured",
      "history/index.html is missing",
    ]);
  });
});
