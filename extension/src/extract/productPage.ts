// SPEC.md section 9's four locales. The host suffix is the only thing that
// varies enough to be worth a lookup table; the rest of amazon's product
// url shape (/dp/{ASIN} and /gp/product/{ASIN}) is stable across all of
// them and has been for years, unlike anything selector based.
const LOCALE_BY_HOST: Record<string, string> = {
  "www.amazon.com": "com",
  "www.amazon.fr": "fr",
  "www.amazon.de": "de",
  "www.amazon.co.uk": "co.uk",
};

// an ASIN is ten upper case letters and digits, amazon's own format.
const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
const PRODUCT_PATH_PATTERN = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i;

export interface ParsedProductPage {
  site: "amazon";
  locale: string;
  productId: string;
}

// null for anything that is not a recognised amazon product page: a
// different host, a search results page, a cart, a seller storefront. SPEC.md
// section 13: "page is not a product page: render nothing at all", and this
// is the function that decision starts from.
export function parseAmazonProductUrl(url: string): ParsedProductPage | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const locale = LOCALE_BY_HOST[parsed.hostname];
  if (locale === undefined) {
    return null;
  }
  const match = PRODUCT_PATH_PATTERN.exec(parsed.pathname);
  if (match === null) {
    return null;
  }
  const productId = (match[1] as string).toUpperCase();
  if (!ASIN_PATTERN.test(productId)) {
    return null;
  }
  return { site: "amazon", locale, productId };
}

// SPEC.md section 9's "fetching additional pages" for a given page number,
// in the same shape amazon's own pagination links use. Not itself a fetch,
// callers decide when and whether to use it.
export function reviewPageUrl(page: ParsedProductPage, pageNumber: number): string {
  const host = Object.entries(LOCALE_BY_HOST).find(([, locale]) => locale === page.locale)?.[0];
  return `https://${host}/product-reviews/${page.productId}/?pageNumber=${pageNumber}`;
}
