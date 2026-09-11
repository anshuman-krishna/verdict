import { browser } from "wxt/browser";
import type { RulesDocument } from "../extract/rules";
import type { ContributionEdge } from "../graph/edge";
import {
  STORAGE_MESSAGE_TYPE,
  type ContentSettings,
  type HistoryDraft,
  type StorageRequest,
  type StorageResponse,
} from "./messages";
import {
  hydrateCacheRecord,
  toStored,
  type CachedReviews,
  type ReviewsCacheRecord,
} from "./reviewsCodec";
import type { Review } from "../extract/types";
import type { PreviousCheck } from "./history";

export type SendToBackground = (request: StorageRequest) => Promise<unknown>;

const realSend: SendToBackground = (request) => browser.runtime.sendMessage(request);

// a storefront page shares its indexeddb with the content script, so nothing is stored here
async function ask<T>(send: SendToBackground, request: StorageRequest, fallback: T): Promise<T> {
  try {
    const response = (await send(request)) as StorageResponse | undefined;
    if (response === undefined || !response.ok) {
      return fallback;
    }
    return response.value as T;
  } catch {
    return fallback;
  }
}

// a background we cannot reach means no consent we can read, so nothing runs
export const NOTHING_ENABLED: ContentSettings = {
  historyEnabled: false,
  reputationLookupEnabled: false,
  graphContributionEnabled: false,
};

export function readSettings(send: SendToBackground = realSend): Promise<ContentSettings> {
  return ask(send, { type: STORAGE_MESSAGE_TYPE, op: "settings" }, NOTHING_ENABLED);
}

export function readRules(
  bundledDefault: RulesDocument,
  send: SendToBackground = realSend,
): Promise<RulesDocument> {
  return ask(send, { type: STORAGE_MESSAGE_TYPE, op: "rules" }, bundledDefault);
}

export function readChecksOfProduct(
  productKey: string,
  send: SendToBackground = realSend,
): Promise<PreviousCheck[]> {
  return ask(send, { type: STORAGE_MESSAGE_TYPE, op: "history-of-product", productKey }, []);
}

export function saveHistoryEntry(
  entry: HistoryDraft,
  send: SendToBackground = realSend,
): Promise<null> {
  return ask(send, { type: STORAGE_MESSAGE_TYPE, op: "history-add", entry }, null);
}

export function queueContributionEdges(
  edges: readonly ContributionEdge[],
  send: SendToBackground = realSend,
): Promise<null> {
  return ask(
    send,
    { type: STORAGE_MESSAGE_TYPE, op: "contribution-enqueue", edges: [...edges] },
    null,
  );
}

export function reviewsCacheVia(send: SendToBackground = realSend) {
  return {
    read: async (productId: string, site: string): Promise<CachedReviews | null> => {
      const record = await ask<ReviewsCacheRecord | null>(
        send,
        { type: STORAGE_MESSAGE_TYPE, op: "reviews-get", productId, site },
        null,
      );
      return record === null ? null : hydrateCacheRecord(record);
    },
    write: async (
      productId: string,
      site: string,
      reviews: readonly Review[],
      pagesFetched: number,
    ): Promise<void> => {
      // signatures are computed here, so no review text crosses
      await ask(
        send,
        {
          type: STORAGE_MESSAGE_TYPE,
          op: "reviews-put",
          productId,
          site,
          reviews: reviews.map(toStored),
          pagesFetched,
        },
        null,
      );
    },
  };
}
