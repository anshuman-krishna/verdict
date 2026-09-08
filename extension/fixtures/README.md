# Fixture corpus

Saved product pages and what is true about them, read off the page by eye.
This corpus is the only thing standing between a confident extractor and a
silently broken one, so the expectation files are written by hand and are
never generated from what the extractor currently outputs. A corpus derived
from the code it is meant to check measures nothing.

## What goes in

Roughly 40 pages, saved with devtools "Save as, complete", spread across:

- locales `com`, `fr`, `de`, `co.uk`, because SPEC.md section 14 asks for
  correct extraction across at least four
- four product categories, since rating shapes differ by category
- review counts from about 12 up to tens of thousands
- at least three listings that look manipulated and three that look clean

## Layout

Two files per fixture, sharing a base name:

```
b0abcdef12.html    the saved page
b0abcdef12.json    what you can verify by eye
```

A page with no expectation file, or an expectation file with no page, is an
error rather than a skip. Both halves are required for the fixture to count.

## The expectation file

```json
{
  "url": "https://www.amazon.fr/dp/B0ABCDEF12",
  "layout": "modern",
  "reviewCount": 8043,
  "claimedRating": 4.6,
  "minimumExtractedReviews": 8,
  "notes": "seller changed in 2023, kept for the drift case"
}
```

| field | required | meaning |
|---|---|---|
| `url` | yes | the page this html came from. Site and locale are read back out of it, so there is no second place for them to disagree |
| `layout` | yes | `modern` or `legacy` |
| `reviewCount` | yes | the total the listing claims. `null` if the page shows none |
| `claimedRating` | yes | the stars the listing claims. `null` if the page shows none |
| `title` | no | checked only when present, since a long title retyped by hand fails more often than the extractor does |
| `category` | no | as above |
| `minimumExtractedReviews` | no | a floor on how many review blocks the page should yield. Nobody is asked to count them exactly; absent means the count is reported and not judged |
| `notes` | no | why this page is in the corpus |

`reviewCount` and `claimedRating` are required rather than optional on
purpose. Writing `null` is a statement that the page shows neither, which is
a fact about the page. Leaving the key out is an unfinished file, and the
reader rejects it.

## Running it

```
just fixtures
```

Prints one line per failing fixture, naming the field and the strategy that
ran, and reports the pass rate and the locale spread against SPEC.md section
14. It exits non zero when the corpus is empty, because unmeasured is not
the same as passing.

## Labelling a fixture

`just featurise` turns these pages into the training corpus. It reads a
separate label file, one json object per line, naming fixtures by their base
name. See `research/labels.example.jsonl`.

```json
{"fixture": "b0abcdef12", "label": 1, "source": "solicitation", "notes": "..."}
```

| field | required | meaning |
|---|---|---|
| `fixture` | yes | the base name shared by the page and its expectation file |
| `label` | yes | `1` manipulated, `0` clean. Nothing else is accepted |
| `source` | no | which of SPEC.md section 12's four sources this label came from, since they are not equally strong |
| `notes` | no | why this listing carries this label |

Labelling one fixture twice is an error rather than a last write wins, since
two rows for one page is a disagreement about ground truth.

The corpus that comes out carries features, labels, and the locale, and no
url, title, or reviewer id. `just featurise ... --print-mapping` prints which
fixture produced which row while the run is in front of you, so tracing a
surprising row back does not require the corpus to be a list of products.
