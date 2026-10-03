// happy-dom has no isolated worlds, so what only a real browser does is checked here
export const STOREFRONT_URL = "https://www.amazon.com/dp/B0SMOKETST";
export const SITE_URL = "https://verdict.tools/";
export const EXTENSION_PAGES = ["popup.html", "options.html"];

const DAY_MS = 24 * 60 * 60 * 1000;

// synthetic schema.org markup, enough for the content script to reach a verdict, not a fixture
export function storefrontPage(reviewCount = 45) {
  const reviews = Array.from({ length: reviewCount }, (_, index) => ({
    "@type": "Review",
    author: { "@type": "Person", name: `reviewer ${index}` },
    datePublished: new Date(Date.UTC(2026, 0, 1) + index * 3 * DAY_MS).toISOString().slice(0, 10),
    reviewRating: { "@type": "Rating", ratingValue: String((index % 5) + 1), bestRating: "5" },
    reviewBody: `review number ${index} of a kettle`,
  }));
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "smoke test kettle",
    aggregateRating: { "@type": "AggregateRating", ratingValue: "4.0", reviewCount: String(reviewCount) },
    review: reviews,
  };
  return `<!doctype html><html lang="en"><head><title>smoke test kettle</title>`
    + `<script type="application/ld+json">${JSON.stringify(product)}</script></head>`
    + `<body><h1>smoke test kettle</h1></body></html>`;
}

export const SITE_PAGE = `<!doctype html><html lang="en"><head><title>verdict</title></head><body></body></html>`;

export function storefrontProblems({ errors, mounted }) {
  const problems = errors.map((error) => `the storefront content script threw: ${error}`);
  if (mounted.length !== 1) {
    problems.push(
      `a product page should carry exactly one panel or notice, it carried ${mounted.length}`
        + (mounted.length > 0 ? ` (${mounted.join(", ")})` : ""),
    );
  }
  return problems;
}

export function siteProblems({ errors, relay }) {
  const problems = errors.map((error) => `the presence content script threw: ${error}`);
  if (relay !== "true") {
    problems.push("verdict.tools never got the relay, so the website cannot reach the extension");
  }
  return problems;
}

export function extensionPageProblems(page, { errors, lang, mainCount, headingCount }) {
  const problems = errors.map((error) => `${page} threw: ${error}`);
  if (!lang) {
    problems.push(`${page} declares no language`);
  }
  if (mainCount !== 1) {
    problems.push(`${page} has ${mainCount} main landmarks, it needs one`);
  }
  if (headingCount !== 1) {
    problems.push(`${page} has ${headingCount} top level headings, it needs one`);
  }
  return problems;
}

export function reopenProblems({ status, reopened, mountedAfter }) {
  const problems = [];
  if (status?.hidden !== true) {
    problems.push("after the reader closed it, the tab did not say a reading was hidden");
  }
  if (reopened?.reopened !== true) {
    problems.push("the tab did not bring the closed panel back when asked");
  }
  if (mountedAfter !== 1) {
    problems.push(`bringing the panel back left ${mountedAfter} panels or notices, it should leave one`);
  }
  return problems;
}
