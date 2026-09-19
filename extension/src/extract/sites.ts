import registry from "../../../schema/sites.json";

export interface SiteLocale {
  host: string;
  domain: string;
}

// what a platform reviews. the interface says business where a platform reviews one, since
// "these reviews describe a different product" is the wrong sentence about a restaurant
export type SiteSubject = "product" | "place";

// a draft platform is registered and tested, and is stripped from a production manifest, so
// rules that are not finished yet never reach a reader
export type SiteStatus = "supported" | "draft";

// paged-url builds a url per page of reviews. page-only says the platform has no such url
export type ReviewSource = "paged-url" | "page-only";

export interface SiteDefinition {
  id: string;
  locales: Record<string, SiteLocale>;
  productPath: string;
  productId: string;
  reviewPath?: string;
  maxReviewPages?: number;
  imageHosts?: string[];
  subject?: SiteSubject;
  status?: SiteStatus;
  pathPrefix?: string;
  idCase?: "upper" | "preserve";
  reviewSource?: ReviewSource;
  absentSignals?: string[];
}

export interface ParsedProductPage {
  site: string;
  locale: string;
  productId: string;
}

export const SITES: readonly SiteDefinition[] = registry.sites as SiteDefinition[];

export const DEFAULT_SUBJECT: SiteSubject = "product";

export function subjectOf(
  siteId: string,
  sites: readonly SiteDefinition[] = SITES,
): SiteSubject {
  return siteById(siteId, sites)?.subject ?? DEFAULT_SUBJECT;
}

export function isDraftSite(
  siteId: string,
  sites: readonly SiteDefinition[] = SITES,
): boolean {
  return siteById(siteId, sites)?.status === "draft";
}

// SPEC.md section 6 would rather widen an estimate than report a signal as unreadable when the
// platform never recorded it in the first place
export function absentSignalsFor(
  siteId: string,
  sites: readonly SiteDefinition[] = SITES,
): readonly string[] {
  return siteById(siteId, sites)?.absentSignals ?? [];
}

export function reviewSourceOf(
  siteId: string,
  sites: readonly SiteDefinition[] = SITES,
): ReviewSource {
  const site = siteById(siteId, sites);
  if (site === null) {
    return "paged-url";
  }
  return site.reviewSource ?? (site.reviewPath === undefined ? "page-only" : "paged-url");
}

// whether a deeper read is a thing this platform can offer at all
export function canFetchReviewPages(
  siteId: string,
  sites: readonly SiteDefinition[] = SITES,
): boolean {
  return reviewSourceOf(siteId, sites) === "paged-url";
}

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
      // another platform may live on the same host under a different path
      continue;
    }
    const matched = match[1] as string;
    const productId = site.idCase === "preserve" ? matched : matched.toUpperCase();
    if (!new RegExp(site.productId).test(productId)) {
      continue;
    }
    return { site: site.id, locale, productId };
  }
  return null;
}

// which storefront a page belongs to, before anything has been parsed off it
export function siteForHost(
  hostname: string,
  sites: readonly SiteDefinition[] = SITES,
): SiteDefinition | null {
  return sites.find((site) =>
    Object.values(site.locales).some((entry) => entry.host === hostname)
  ) ?? null;
}

// which locale of a storefront a host is, before any url has been parsed off it
export function localeForHost(
  hostname: string,
  sites: readonly SiteDefinition[] = SITES,
): string | null {
  for (const site of sites) {
    const found = Object.entries(site.locales).find(([, entry]) => entry.host === hostname);
    if (found !== undefined) {
      return found[0];
    }
  }
  return null;
}

// a storefront that has not declared its ceiling gets the shallow default
export const DEFAULT_REVIEW_PAGE_CAP = 5;

export function reviewPageCap(
  siteId: string,
  sites: readonly SiteDefinition[] = SITES,
): number {
  return siteById(siteId, sites)?.maxReviewPages ?? DEFAULT_REVIEW_PAGE_CAP;
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
  if (site.reviewPath === undefined) {
    throw new Error(`${page.site} has no review page url`);
  }
  const path = site.reviewPath
    .replaceAll("{productId}", page.productId)
    .replaceAll("{pageNumber}", String(pageNumber));
  return `https://${entry.host}${path}`;
}

// the manifest is built from this. a platform under a path prefix is matched to that prefix,
// so a host that also serves other things is not read where verdict has nothing to say
export function matchesFor(site: SiteDefinition): string[] {
  const prefix = site.pathPrefix === undefined ? "" : site.pathPrefix;
  return Object.values(site.locales).map((entry) => `https://${entry.host}${prefix}/*`);
}

export function contentScriptMatches(sites: readonly SiteDefinition[] = SITES): string[] {
  return sites.flatMap(matchesFor);
}

// what a production build matches. a draft platform is readable in development only
export function supportedContentScriptMatches(
  sites: readonly SiteDefinition[] = SITES,
): string[] {
  return sites.filter((site) => site.status !== "draft").flatMap(matchesFor);
}

interface ContentScriptManifest {
  content_scripts?: { matches?: string[] }[];
}

// store builds never carry a platform whose rules are still being written
export function withoutDraftPlatforms<T extends ContentScriptManifest>(manifest: T): T {
  if (manifest.content_scripts === undefined) {
    return manifest;
  }
  const supported = new Set(supportedContentScriptMatches());
  const draft = new Set(contentScriptMatches().filter((match) => !supported.has(match)));
  manifest.content_scripts = manifest.content_scripts
    .map((script) => ({
      ...script,
      matches: script.matches?.filter((match) => !draft.has(match)),
    }))
    .filter((script) => script.matches === undefined || script.matches.length > 0);
  return manifest;
}

// the bridge can only check a page the content script runs on, so both follow the manifest
// and a platform stripped from a store build is unreachable from the website too
export function siteIdsMatchedBy(
  matches: readonly string[],
  sites: readonly SiteDefinition[] = SITES,
): string[] {
  const declared = new Set(matches);
  return sites
    .filter((site) => matchesFor(site).some((match) => declared.has(match)))
    .map((site) => site.id);
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
