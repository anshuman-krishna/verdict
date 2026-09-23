import type { RulesDocument } from "../extract/rules";
import { isSafeSiteId } from "../extract/remoteRules";
import { storefrontHosts } from "../extract/sites";
import { enqueueContributionEdges } from "../graph/queue";
import { addHistoryEntry, listChecksOfProduct } from "./history";
import { isStorageRequest, type StorageRequest, type StorageResponse } from "./messages";
import { putStoredReviews, readCacheRecord } from "./reviewsCache";
import {
  NOT_WATCHED,
  readWatch,
  recordWatchedCheck,
  statusOf,
  unwatchListing,
  watchListing,
} from "./watchlist";
import {
  getGraphContributionEnabled,
  getHistoryEnabled,
  getReputationLookupEnabled,
  isAnalysisAllowedOn,
} from "./settings";

export interface StorageSender {
  url?: string;
  tab?: { id?: number };
}

export interface ServeStorageDeps {
  rules: (siteId: string) => Promise<RulesDocument>;
  hosts?: readonly string[];
  // a tab opened for a check on the website, where a paused platform is still read
  isCheckTab?: (tabId: number | undefined) => boolean;
}

const REFUSED: StorageResponse = { ok: false };

// only our own content scripts, and only from a storefront we support
export function isOurContentScript(
  sender: StorageSender,
  hosts: readonly string[] = storefrontHosts(),
): boolean {
  if (sender.tab?.id === undefined || sender.url === undefined) {
    return false;
  }
  try {
    const url = new URL(sender.url);
    return url.protocol === "https:" && hosts.includes(url.hostname);
  } catch {
    return false;
  }
}

export async function serveStorageRequest(
  message: unknown,
  sender: StorageSender,
  deps: ServeStorageDeps,
): Promise<StorageResponse> {
  if (!isStorageRequest(message) || !isOurContentScript(sender, deps.hosts)) {
    return REFUSED;
  }
  try {
    return { ok: true, value: await run(message, deps, sender) };
  } catch {
    return REFUSED;
  }
}

async function run(request: StorageRequest, deps: ServeStorageDeps, sender: StorageSender) {
  switch (request.op) {
    case "analysis-allowed":
      if (!isSafeSiteId(request.site)) {
        throw new Error("not a site id");
      }
      // the reader asked for this one, so the switch they set for browsing does not apply
      if (deps.isCheckTab?.(sender.tab?.id) === true) {
        return true;
      }
      return await isAnalysisAllowedOn(request.site);
    case "settings":
      // read only, so a page cannot turn anything on for the user
      return {
        historyEnabled: await getHistoryEnabled(),
        reputationLookupEnabled: await getReputationLookupEnabled(),
        graphContributionEnabled: await getGraphContributionEnabled(),
      };
    case "rules":
      // the site the caller claims, never a path this build did not build itself
      if (!isSafeSiteId(request.site)) {
        throw new Error("not a site id");
      }
      return await deps.rules(request.site);
    case "history-add":
      if (!(await getHistoryEnabled())) {
        return null;
      }
      await addHistoryEntry(request.entry);
      return null;
    case "history-of-product":
      // only what the panel shows, never another product's entries
      return await listChecksOfProduct(request.productKey);
    case "contribution-enqueue":
      if (!(await getGraphContributionEnabled())) {
        return null;
      }
      await enqueueContributionEdges(request.edges);
      return null;
    case "watch-add":
      // watching is something the reader asked for, so it is not gated on history
      await watchListing(request.listing);
      return statusOf(await readWatch(request.listing.productKey));
    case "watch-remove":
      await unwatchListing(request.productKey);
      return NOT_WATCHED;
    case "watch-check":
      return await recordWatchedCheck(request.productKey, request.reading);
    case "reviews-get":
      return await readCacheRecord(request.productId, request.site);
    case "reviews-put":
      await putStoredReviews(
        request.productId,
        request.site,
        request.reviews,
        request.pagesFetched,
        request.exhausted === true,
      );
      return null;
    default:
      // an op this build does not serve is refused, never guessed at
      throw new Error("unknown storage op");
  }
}
