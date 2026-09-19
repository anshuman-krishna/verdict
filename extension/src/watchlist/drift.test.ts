import { describe, expect, it } from "vitest";
import { compareReadings, WATCH_THRESHOLDS } from "./drift";
import type { WatchReading } from "./reading";
import { changeLine, changeLines } from "./text";

function reading(overrides: Partial<WatchReading> = {}): WatchReading {
  return {
    at: 1_700_000_000_000,
    band: "mostly-clean",
    probability: 0.2,
    claimedRating: 4.6,
    adjustedRating: 4.4,
    totalReviewCount: 400,
    features: {
      "temporalBurst.largestBurstShare": 0.05,
      "listingDrift.driftStatistic": 0.1,
    },
    ...overrides,
  };
}

describe("compareReadings", () => {
  it("says nothing about a listing that has not moved", () => {
    expect(compareReadings(reading(), reading())).toEqual([]);
  });

  it("names the band it read then and the band it reads now", () => {
    const changes = compareReadings(reading(), reading({ band: "doubtful" }));

    expect(changes).toEqual([{ kind: "band", from: "mostly-clean", to: "doubtful" }]);
  });

  it("stays quiet about a rating that moved less than a printed notch", () => {
    expect(compareReadings(reading(), reading({ adjustedRating: 4.5 }))).toEqual([]);
  });

  it("names a rating that moved a notch, in either direction", () => {
    expect(compareReadings(reading(), reading({ adjustedRating: 4.2 }))).toEqual([
      { kind: "rating", from: 4.4, to: 4.2 },
    ]);
    expect(compareReadings(reading(), reading({ adjustedRating: 4.6 }))).toEqual([
      { kind: "rating", from: 4.4, to: 4.6 },
    ]);
  });

  it("names a run of new reviews, not a trickle", () => {
    expect(compareReadings(reading(), reading({ totalReviewCount: 440 }))).toEqual([]);
    expect(compareReadings(reading(), reading({ totalReviewCount: 500 }))).toEqual([
      { kind: "reviews", from: 400, to: 500 },
    ]);
  });

  it("uses the floor rather than the share on a listing with few reviews", () => {
    const small = reading({ totalReviewCount: 40 });

    expect(compareReadings(small, reading({ totalReviewCount: 60 }))).toEqual([]);
    expect(compareReadings(small, reading({ totalReviewCount: 95 }))).toEqual([
      { kind: "reviews", from: 40, to: 95 },
    ]);
  });

  it("says nothing about reviews that went away, which is a page reading differently", () => {
    expect(compareReadings(reading(), reading({ totalReviewCount: 100 }))).toEqual([]);
  });

  it("names a burst that grew, and not one that faded", () => {
    const features = { "temporalBurst.largestBurstShare": 0.2, "listingDrift.driftStatistic": 0.1 };

    expect(compareReadings(reading(), reading({ features }))).toEqual([
      { kind: "burst", from: 0.05, to: 0.2 },
    ]);
    expect(compareReadings(reading({ features }), reading())).toEqual([]);
  });

  it("names drift only when it crossed into what the signal reports", () => {
    const below = { "listingDrift.driftStatistic": 0.4, "temporalBurst.largestBurstShare": 0.05 };
    const above = { "listingDrift.driftStatistic": 0.7, "temporalBurst.largestBurstShare": 0.05 };

    expect(compareReadings(reading({ features: below }), reading({ features: below }))).toEqual([]);
    expect(compareReadings(reading({ features: below }), reading({ features: above }))).toEqual([
      { kind: "drift", from: 0.4, to: 0.7 },
    ]);
    expect(compareReadings(reading({ features: above }), reading({ features: above }))).toEqual([]);
  });

  it("compares nothing it was not given on both sides", () => {
    const blank = reading({
      band: null,
      adjustedRating: null,
      totalReviewCount: null,
      features: null,
    });

    expect(compareReadings(blank, reading())).toEqual([]);
    expect(compareReadings(reading(), blank)).toEqual([]);
  });

  it("takes the thresholds it is handed", () => {
    const strict = { ...WATCH_THRESHOLDS, rating: 0.01 };

    expect(compareReadings(reading(), reading({ adjustedRating: 4.45 }), strict)).toHaveLength(1);
  });

  it("reports everything that moved, in a fixed order", () => {
    const later = reading({
      band: "doubtful",
      adjustedRating: 3.9,
      totalReviewCount: 900,
      features: { "temporalBurst.largestBurstShare": 0.4, "listingDrift.driftStatistic": 0.8 },
    });

    expect(compareReadings(reading(), later).map((change) => change.kind)).toEqual([
      "band",
      "rating",
      "reviews",
      "burst",
      "drift",
    ]);
  });
});

describe("changeLine", () => {
  it("puts a band change in the words the panel uses", () => {
    expect(changeLine({ kind: "band", from: "mostly-clean", to: "doubtful" })).toBe(
      "It read mostly clean then, and reads doubtful now.",
    );
  });

  it("prints a rating to one place, the way the panel does", () => {
    expect(changeLine({ kind: "rating", from: 4.43, to: 3.87 })).toBe(
      "The adjusted rating moved from 4.4 to 3.9.",
    );
  });

  it("prints a burst as a percentage", () => {
    expect(changeLine({ kind: "burst", from: 0.05, to: 0.22 })).toContain("5 to 22 percent");
  });

  it("says what drift means rather than printing a statistic", () => {
    expect(changeLine({ kind: "drift", from: 0.4, to: 0.8 })).toBe(
      "Its reviews have moved away from what the listing says it sells.",
    );
  });

  it("renders a whole list", () => {
    expect(
      changeLines([
        { kind: "reviews", from: 400, to: 900 },
        { kind: "drift", from: 0.4, to: 0.8 },
      ]),
    ).toHaveLength(2);
  });
});
