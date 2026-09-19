export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export interface PluralMessage {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

export type Message = string | PluralMessage;

// english is the source of truth. every other catalogue is a partial of these ids, and a
// missing id falls back to the line below rather than to a blank
export const ENGLISH = {
  "band.clean": "clean",
  "band.mostly-clean": "mostly clean",
  "band.mixed": "mixed",
  "band.doubtful": "doubtful",
  "band.heavily-manipulated": "heavily manipulated",

  "signal.ratingDeconvolution": "rating shape",
  "signal.temporalBurst": "arrival timing",
  "signal.verificationConcentration": "verification pattern",
  "signal.textNearDuplication": "duplicate text",
  "signal.listingDrift": "different product",
  "signal.listingDrift.place": "different business",
  "signal.reviewerGraph": "reviewer network",

  "strength.none": "none",
  "strength.weak": "weak",
  "strength.moderate": "moderate",
  "strength.strong": "strong",

  "list.and": "and",

  "count.reviews": { one: "1 review", other: "{count} reviews" },
  "count.pages": { one: "1 page", other: "{count} pages" },

  "panel.regionLabel": "Verdict report",
  "panel.close": "Close",
  "panel.rosetteAlt": "{band}, estimated {percent} percent of reviews are inorganic",
  "panel.adjusted": "adjusted",
  "panel.claimed": "claimed",
  "panel.summary": "{band}. {excluded} of {total} reviews look inorganic.",
  "panel.stripAlt": "{kept} reviews kept, {excluded} reviews excluded",
  "panel.kept": "kept {count}",
  "panel.excluded": "excluded {count}",
  "panel.evidence": "evidence",
  "panel.fullReport": "full report",
  "panel.checkedJustNow": "checked just now",
  "panel.checkedMinutes": {
    one: "checked {count} minute ago",
    other: "checked {count} minutes ago",
  },
  "panel.checkedHours": { one: "checked {count} hour ago", other: "checked {count} hours ago" },

  "confidence.point": "The estimate sits between {percent} percent of reviews.",
  "confidence.range": "The estimate sits between {low} to {high} percent of reviews.",
  "confidence.unavailable": "{signals} could not be read on this page, which widens it.",
  "confidence.absent": "This platform does not record {signals}, which widens it.",
  "pending.line": "Still reading the {signals}, so this may still move.",

  "when.earlierToday": "earlier today",
  "when.yesterday": "yesterday",
  "when.days": { one: "{count} day ago", other: "{count} days ago" },
  "when.months": { one: "a month ago", other: "{count} months ago" },

  "previously.unknown": "You checked this listing {when}.",
  "previously.same": "You checked this listing {when}, and it read {band} then too.",
  "previously.changed": "You checked this listing {when}, when it read {band}.",

  "evidence.ratingShape.none": "No star ratings to compare against an expected shape.",
  "evidence.ratingShape.share":
    "The rating distribution is consistent with about {percent} percent of reviews being added outside the organic pattern.",
  "evidence.arrivalTiming.none": "No dated reviews to place on a timeline.",
  "evidence.arrivalTiming.quiet": "No unusual clustering in when reviews arrived.",
  "evidence.arrivalTiming.bursts": {
    one: "{count} unusual arrival burst, covering about {percent} percent of reviews.",
    other: "{count} unusual arrival bursts, covering about {percent} percent of reviews.",
  },
  "evidence.verification.none":
    "Not enough reviews in unusual arrival windows to compare verification rates.",
  "evidence.verification.lift":
    "Unverified reviews are about {lift}x as common among five star reviews inside unusual arrival windows as elsewhere.",
  "evidence.duplicateText.none": "No review text to compare.",
  "evidence.duplicateText.clusters": {
    one: "{count} cluster of near duplicate text, about {percent} percent of reviews with text.",
    other: "{count} clusters of near duplicate text, about {percent} percent of reviews with text.",
  },
  "evidence.differentProduct.none": "No review text to compare against the product.",
  "evidence.differentProduct.none.place": "No review text to compare against the business.",
  "evidence.differentProduct.noTitle": "No product title to compare the reviews against.",
  "evidence.differentProduct.noTitle.place": "No business name to compare the reviews against.",
  "evidence.differentProduct.share":
    "{count} of {embedded} reviews with text share no wording with the current product title and category.",
  "evidence.differentProduct.share.place":
    "{count} of {embedded} reviews with text share no wording with the current business name and category.",
  "evidence.differentProduct.shift": "The wording of reviews shifts around {day}.",
  "evidence.reviewerNetwork.none": "No reviewer identifiers to check against the network.",
  "evidence.reviewerNetwork.share":
    "About {percent} percent of the reviews here were written by {flagged} of {known} accounts that also appear in networks flagged across many products.",

  "notice.unreadable": "Verdict could not read this page.",
  "notice.statusLink": "extraction status",
  "notice.missingSignals":
    "Verdict could not read enough of this page to judge it. Missing: {signals}.",
  "notice.noModel": "This build of Verdict carries no scoring model, so it cannot judge a page.",
  "notice.notEnoughReviews": "Not enough reviews to judge this one. {reviews} found.",
  "notice.everyPageRead": "Not enough reviews to judge this one. {reviews} across {pages}, {reach}.",
  "notice.pageOnly":
    "Not enough reviews to judge this one. {reviews} found, and this platform has no further pages to read.",
  "notice.reachOwnCeiling": "which is as deep as Verdict reads",
  "notice.reachEveryPage": "which is every page this listing has",
  "notice.checkMoreDeeply": "check more deeply",
  "notice.checkingMoreDeeply": "checking more deeply...",
  "notice.readingUpTo": {
    one: "Reading up to {count} more page of reviews.",
    other: "Reading up to {count} more pages of reviews.",
  },
  "notice.progress": "{read} of {total} pages read, {reviews} so far.",
  "notice.reading": "Reading the reviews on this page.",

  "detail.back": "Back to history",
  "detail.intervalPoint": "Estimated {percent} percent of reviews.",
  "detail.intervalRange": "Estimated between {low} and {high} percent of reviews.",
  "detail.unavailable": "{signals} could not be read on this page, which widens the estimate.",
  "detail.absent": "This platform does not record {signals}, which widens the estimate.",
  "detail.rescored": "Scored again with the current model, this reads as {band}.",
  "detail.unreadable":
    "This check was saved by an older version, so only its heading is readable.",
  "detail.checked": "Checked {date}.",
  "detail.earlierChecks": "earlier checks",
  "detail.evidence": "evidence",
  "detail.howProduced": "how this was produced",
  "detail.stripAlt": "{kept} reviews kept, {excluded} excluded",
  "detail.exportText": "Export this report",
  "detail.exportJson": "Export as JSON",

  "popup.settings": "Settings",
  "popup.search": "Search checks",
  "popup.searchPlaceholder": "search",
  "popup.empty": "No checks yet.",
  "popup.noMatches": "No checks match that.",
  "popup.exportJson": "export json",
  "popup.exportCsv": "export csv",
  "popup.deleteAll": "delete everything",
  "popup.confirmDelete": "confirm delete",

  "watch.add": "Keep an eye on this",
  "watch.remove": "Stop watching",
  "watch.added": "Saved. The next check of this listing is compared against this one.",
  "watch.since": "Since you saved it {when}:",
  "watch.nothing": "Nothing has moved since you saved it {when}.",
  "watch.change.band": "It read {from} then, and reads {to} now.",
  "watch.change.rating": "The adjusted rating moved from {from} to {to}.",
  "watch.change.reviews": "It has gone from {from} to {to} reviews.",
  "watch.change.burst": "More of its reviews now arrive in unusual windows, {from} to {to} percent.",
  "watch.change.drift": "Its reviews have moved away from what the listing says it sells.",

  "watchlist.heading": "Watching",
  "watchlist.empty": "Nothing watched yet.",
  "watchlist.moved": { one: "{count} thing moved", other: "{count} things moved" },
  "watchlist.steady": "nothing moved",
  "watchlist.remove": "Stop watching this listing",
  "watchlist.lastSeen": "last read {when}",
} as const satisfies Record<string, Message>;

export type MessageId = keyof typeof ENGLISH;

export type Catalogue = Partial<Record<MessageId, Message>>;

export const MESSAGE_IDS = Object.keys(ENGLISH) as MessageId[];

export function isMessageId(value: string): value is MessageId {
  return Object.hasOwn(ENGLISH, value);
}

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

// the names a line interpolates, so a translation that drops or invents one is caught
// before it ships rather than rendering the word "{count}" at somebody
export function placeholdersIn(message: Message): string[] {
  const forms = typeof message === "string" ? [message] : Object.values(message);
  const names = new Set<string>();
  for (const form of forms) {
    for (const match of form.matchAll(PLACEHOLDER)) {
      names.add(match[1] as string);
    }
  }
  return [...names].sort();
}

export function isPlural(message: Message): message is PluralMessage {
  return typeof message !== "string";
}
