import { describe, expect, it } from "vitest";
import { headerProblems, HOME_BUDGET_BYTES, homeWeight, loadedUrls, siteProblems } from "./siteBudget.mjs";

const NOSCRIPT = "<noscript><p>needs javascript</p></noscript>";
const sizes = (table) => (url) => table[url] ?? null;

function site(overrides = {}) {
  const pages = {
    "index.html": "<html><body>home</body></html>",
    "check/index.html": `<html>${NOSCRIPT}<script src="/c.js"></script></html>`,
    "history/index.html": `<html>${NOSCRIPT}<script src="/h.js"></script></html>`,
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

  it("follows a stylesheet the site serves, so a font cdn cannot hide inside it", () => {
    const texts = { "/a.css": "@import url('https://fonts.example/css'); @font-face { src: url(/f.woff2) }" };
    const problems = siteProblems(
      site({ "method/index.html": '<link rel="stylesheet" href="/a.css">' }),
      sizes({}),
      (url) => texts[url] ?? null,
    );
    expect(problems).toEqual([
      "method/index.html loads https://fonts.example/css from another origin, and SITE.md allows no third party",
    ]);
  });

  it("weighs what a stylesheet loads as part of the home page", () => {
    const html = '<link rel="stylesheet" href="/a.css">';
    const texts = { "/a.css": "@font-face { src: url('/f.woff2') }" };
    expect(homeWeight(html, sizes({ "/a.css": 10, "/f.woff2": 1000 }), (url) => texts[url] ?? null)).toBe(
      html.length + 1010,
    );
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
    const problems = siteProblems(site({ "check/index.html": '<script src="/c.js"></script>' }), sizes({}));
    expect(problems).toEqual([
      "check/index.html talks to the extension and says nothing when javascript is off",
    ]);
  });

  it("names an inline script, which the content security policy refuses to run", () => {
    const problems = siteProblems(
      site({ "install/index.html": '<script type="module">var e=1</script><script src="/a.js"></script>' }),
      sizes({}),
    );
    expect(problems).toEqual([
      "install/index.html runs an inline script, which script-src 'self' refuses, so it must be a file",
    ]);
  });

  it("notices a page that was never built rather than passing it", () => {
    expect(siteProblems(site({ "history/index.html": null, "index.html": null }), sizes({}))).toEqual([
      "no index.html, so the home page budget was never measured",
      "history/index.html is missing",
    ]);
  });
});

const HEADERS = `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
/rules/*
  Access-Control-Allow-Origin: *
`;

describe("the headers every host serves the site with", () => {
  it("passes a file that keeps to them", () => {
    expect(headerProblems(HEADERS)).toEqual([]);
  });

  it("notices a file that was never written", () => {
    expect(headerProblems(null)).toEqual([
      "no _headers in the build, so the host serves the site with none of them",
    ]);
  });

  it("wants the rules readable by the extension, which holds no host permission for the site", () => {
    expect(headerProblems(HEADERS.replace("Access-Control-Allow-Origin: *", "X-Other: 1"))).toEqual([
      "/rules/* has no access-control-allow-origin, so every install keeps its bundled rules",
    ]);
  });

  it("refuses a page that can be framed, since the bridge pages act on one click", () => {
    expect(headerProblems(HEADERS.replace("; frame-ancestors 'none'", ""))).toEqual([
      "/* lets another site frame the pages, frame-ancestors must be 'none'",
    ]);
  });

  it("refuses scripts from anywhere but the site itself", () => {
    for (const scripts of ["'self' 'unsafe-inline'", "'self' https://cdn.example", "'self' 'unsafe-eval'"]) {
      expect(headerProblems(HEADERS.replace("script-src 'self'", `script-src ${scripts}`))).toEqual([
        "/* lets scripts run from somewhere other than the site, script-src must be 'self'",
      ]);
    }
  });

  it("names a missing header plainly, whatever case the file writes it in", () => {
    const lowered = HEADERS.replace("X-Content-Type-Options", "x-content-type-options");
    expect(headerProblems(lowered)).toEqual([]);
    expect(headerProblems(HEADERS.replace("  Referrer-Policy: no-referrer\n", ""))).toEqual([
      "/* is missing referrer-policy: no-referrer",
    ]);
  });
});
