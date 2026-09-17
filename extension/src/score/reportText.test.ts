import { describe, expect, it } from "vitest";
import { newTranslator } from "../i18n/translator";
import { SIGNAL_NAMES } from "./combine";
import { parseStoredReport, type EvidenceRow } from "./report";
import { bandLabel, evidenceDetail, signalLabel, strengthLabel } from "./reportText";

describe("bandLabel", () => {
  it("reads in english by default", () => {
    expect(bandLabel("heavily-manipulated")).toBe("heavily manipulated");
  });

  it("reads through the catalogue when there is one", () => {
    const t = newTranslator("de-DE", { "band.mixed": "gemischt" }, "de");
    expect(bandLabel("mixed", t)).toBe("gemischt");
  });
});

describe("signalLabel", () => {
  it("finds a line for every signal the combiner names", () => {
    for (const name of Object.values(SIGNAL_NAMES)) {
      const t = newTranslator("en", {}, "en");
      expect(signalLabel(name, t)).toBe(name);
    }
  });

  it("translates by the english name a stored report carries", () => {
    const t = newTranslator("de-DE", { "signal.temporalBurst": "Ankunftszeit" }, "de");
    expect(signalLabel("arrival timing", t)).toBe("Ankunftszeit");
  });

  it("shows a name from a newer build rather than a blank", () => {
    expect(signalLabel("something this build never had")).toBe("something this build never had");
  });
});

describe("strengthLabel", () => {
  it("translates the strength column", () => {
    const t = newTranslator("de-DE", { "strength.strong": "stark" }, "de");
    expect(strengthLabel("strong", t)).toBe("stark");
  });
});

describe("evidenceDetail", () => {
  const row: EvidenceRow = {
    signal: "different product",
    strength: "moderate",
    value: 0.2,
    detail: "12 of 60 reviews with text share no wording with the current product title and category. The wording of reviews shifts around 2025-03-04.",
    messages: [
      { id: "evidence.differentProduct.share", count: 12, params: { embedded: 60 } },
      { id: "evidence.differentProduct.shift", params: { day: "2025-03-04" } },
    ],
  };

  it("rebuilds the english it was stored as", () => {
    expect(evidenceDetail(row)).toBe(row.detail);
  });

  it("says the same thing in another language from the same numbers", () => {
    const t = newTranslator(
      "de-DE",
      {
        "evidence.differentProduct.share": { one: "eine", other: "{count} von {embedded}" },
        "evidence.differentProduct.shift": "Wechsel um {day}.",
      },
      "de",
    );
    expect(evidenceDetail(row, t)).toBe("12 von 60 Wechsel um 2025-03-04.");
  });

  it("keeps the stored english for a row written before messages existed", () => {
    const older: EvidenceRow = { signal: "duplicate text", strength: "weak", value: 0, detail: "nothing to compare" };
    const t = newTranslator("de-DE", { "evidence.duplicateText.none": "nichts" }, "de");
    expect(evidenceDetail(older, t)).toBe("nothing to compare");
  });
});

describe("a report through storage", () => {
  function stored(): unknown {
    return {
      serial: "AAAA-BBBB",
      band: "mixed",
      claimedRating: 4.6,
      adjustedRating: 3.9,
      totalReviewCount: 100,
      excludedReviewCount: 20,
      estimatedInorganicShare: 0.2,
      confidence: { low: 0.1, high: 0.3 },
      generatedAt: 1,
      unavailableSignals: [],
      evidence: [
        {
          signal: "duplicate text",
          strength: "strong",
          value: 0.3,
          detail: "4 clusters of near duplicate text, about 30 percent of reviews with text.",
          messages: [{ id: "evidence.duplicateText.clusters", count: 4, params: { percent: 30 } }],
        },
      ],
    };
  }

  it("comes back with its messages, so it can be read in another language later", () => {
    const parsed = parseStoredReport(stored());
    const t = newTranslator(
      "pl-PL",
      { "evidence.duplicateText.clusters": { one: "jeden", few: "{count} bloki", many: "{count} blokow", other: "{count}" } },
      "pl",
    );
    expect(evidenceDetail(parsed?.evidence[0] as EvidenceRow, t)).toBe("4 bloki");
  });

  it("drops messages naming an id this build never had, and keeps the english", () => {
    const older = stored() as { evidence: { messages: unknown }[] };
    older.evidence[0]!.messages = [{ id: "evidence.fromTheFuture" }];
    const parsed = parseStoredReport(older);
    expect(parsed?.evidence[0]?.messages).toBeUndefined();
    expect(parsed?.evidence[0]?.detail).toContain("4 clusters");
  });
});
