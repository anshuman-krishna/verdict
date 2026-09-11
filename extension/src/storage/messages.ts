import type { RulesDocument } from "../extract/rules";
import type { ContributionEdge } from "../graph/edge";
import type { FeatureVector } from "../score/featureVector";
import type { PreviousCheck } from "./history";
import type { ReviewsCacheRecord, StoredReview } from "./reviewsCodec";

export const STORAGE_MESSAGE_TYPE = "verdict:storage";

export interface ContentSettings {
  historyEnabled: boolean;
  reputationLookupEnabled: boolean;
  graphContributionEnabled: boolean;
}

export interface HistoryDraft {
  title: string;
  thumbnailUrl: string | null;
  report: unknown;
  featureVector: FeatureVector;
  productKey: string | null;
}

export type StorageRequest =
  | { type: typeof STORAGE_MESSAGE_TYPE; op: "settings" }
  | { type: typeof STORAGE_MESSAGE_TYPE; op: "rules" }
  | { type: typeof STORAGE_MESSAGE_TYPE; op: "history-add"; entry: HistoryDraft }
  | { type: typeof STORAGE_MESSAGE_TYPE; op: "history-of-product"; productKey: string }
  | { type: typeof STORAGE_MESSAGE_TYPE; op: "contribution-enqueue"; edges: ContributionEdge[] }
  | { type: typeof STORAGE_MESSAGE_TYPE; op: "reviews-get"; productId: string; site: string }
  | {
      type: typeof STORAGE_MESSAGE_TYPE;
      op: "reviews-put";
      productId: string;
      site: string;
      reviews: StoredReview[];
      pagesFetched: number;
    };

export interface StorageResults {
  settings: ContentSettings;
  rules: RulesDocument;
  "history-add": null;
  "history-of-product": PreviousCheck[];
  "contribution-enqueue": null;
  "reviews-get": ReviewsCacheRecord | null;
  "reviews-put": null;
}

export type StorageResponse =
  | { ok: true; value: StorageResults[StorageRequest["op"]] }
  | { ok: false };

export function isStorageRequest(value: unknown): value is StorageRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).type === STORAGE_MESSAGE_TYPE
  );
}
