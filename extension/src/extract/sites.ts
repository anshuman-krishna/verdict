import registry from "../../../schema/sites.json";

export interface SiteLocale {
  host: string;
  domain: string;
}

export interface SiteDefinition {
  id: string;
  locales: Record<string, SiteLocale>;
  productPath: string;
  productId: string;
  reviewPath: string;
  imageHosts?: string[];
}

export interface ParsedProductPage {
  site: string;
  locale: string;
  productId: string;
}

export const SITES: readonly SiteDefinition[] = registry.sites;

export function siteById(
  id: string,
  sites: readonly SiteDefinition[] = SITES,
): SiteDefinition | null {
  return sites.find((site) => site.id === id) ?? null;
}

export function parseProductUrl(
  url: string,
  sites: readonly SiteDefinition[] = SITES,
): ParsedProductPage | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const site of sites) {
    const locale = Object.entries(site.locales).find(
      ([, entry]) => entry.host === parsed.hostname,
    )?.[0];
    if (locale === undefined) {
      continue;
    }
    const match = new RegExp(site.productPath, "i").exec(parsed.pathname);
    if (match === null) {
      return null;
    }
    const productId = (match[1] as string).toUpperCase();
    if (!new RegExp(site.productId).test(productId)) {
      return null;
    }
    return { site: site.id, locale, productId };
  }
  return null;
}

export function reviewPageUrl(
  page: ParsedProductPage,
  pageNumber: number,
  sites: readonly SiteDefinition[] = SITES,
): string {
  const site = siteById(page.site, sites);
  const entry = site?.locales[page.locale];
  if (site === null || entry === undefined) {
    throw new Error(`no host for ${page.site} ${page.locale}`);
  }
  const path = site.reviewPath
    .replaceAll("{productId}", page.productId)
    .replaceAll("{pageNumber}", String(pageNumber));
  return `https://${entry.host}${path}`;
}

// the manifest is built from this
export function contentScriptMatches(sites: readonly SiteDefinition[] = SITES): string[] {
  return sites.flatMap((site) =>
    Object.values(site.locales).map((entry) => `https://${entry.host}/*`)
  );
}

export function allowedDomains(
  siteId: string,
  locales: readonly string[],
  sites: readonly SiteDefinition[] = SITES,
): string[] {
  const site = siteById(siteId, sites);
  if (site === null) {
    return [];
  }
  return locales
    .map((locale) => site.locales[locale]?.domain)
    .filter((domain): domain is string => domain !== undefined);
}

export function storefrontHosts(sites: readonly SiteDefinition[] = SITES): string[] {
  return sites.flatMap((site) => Object.values(site.locales).map((entry) => entry.host));
}

export function imageHosts(sites: readonly SiteDefinition[] = SITES): string[] {
  return [...storefrontHosts(sites), ...sites.flatMap((site) => site.imageHosts ?? [])];
}

// a thumbnail is a url the seller controls, so it may only point at a storefront we support
export function isStorefrontImageUrl(
  url: string,
  sites: readonly SiteDefinition[] = SITES,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  return imageHosts(sites).some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
  );
}

export function safeThumbnailUrl(
  url: string | null,
  sites: readonly SiteDefinition[] = SITES,
): string | null {
  if (url === null || !isStorefrontImageUrl(url, sites)) {
    return null;
  }
  return url;
}
