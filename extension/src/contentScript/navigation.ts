import { parseProductUrl } from "../extract/sites";

export const URL_POLL_MS = 400;

// query strings churn on every storefront, so identity is the listing, not the url
export function listingIdentity(url: string): string | null {
  const page = parseProductUrl(url);
  return page === null ? null : `${page.site}:${page.locale}:${page.productId}`;
}

export interface UrlWatcherOptions {
  getHref: () => string;
  onChange: (href: string) => void;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  setPoll: (run: () => void, ms: number) => unknown;
  clearPoll: (handle: unknown) => void;
  pollMs?: number;
}

const WATCHED_EVENTS = ["popstate", "hashchange"] as const;

// a content script runs in its own world, so patching history.pushState here would
// never see the page's own calls. polling the url is the only signal we actually get.
export function watchUrl(options: UrlWatcherOptions): () => void {
  let lastHref = options.getHref();

  const check = (): void => {
    const href = options.getHref();
    if (href === lastHref) {
      return;
    }
    lastHref = href;
    options.onChange(href);
  };

  for (const event of WATCHED_EVENTS) {
    options.addEventListener(event, check);
  }
  const handle = options.setPoll(check, options.pollMs ?? URL_POLL_MS);

  return () => {
    for (const event of WATCHED_EVENTS) {
      options.removeEventListener(event, check);
    }
    options.clearPoll(handle);
  };
}

export function browserUrlWatcher(
  onChange: (href: string) => void,
  pollMs: number = URL_POLL_MS,
): () => void {
  return watchUrl({
    getHref: () => location.href,
    onChange,
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
    setPoll: (run, ms) => setInterval(run, ms),
    clearPoll: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    pollMs,
  });
}
