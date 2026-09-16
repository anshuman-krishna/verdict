// a storefront writes its category as a breadcrumb trail, in its own language and
// punctuation. a key is one segment of that trail reduced to something two languages
// can agree on, because the same reduction runs in research/ over the corpus.

const TRAIL_SEPARATORS = /[>›»→/|\n]+/;

// letters, digits and the marks that complete them, which keeps a key in scripts
// that ascii would erase entirely
const KEPT = /[\p{L}\p{N}\p{M}]/u;

export function categorySlug(segment: string): string {
  const normalised = segment.normalize("NFKC").toLowerCase();
  const parts: string[] = [];
  let current = "";
  for (const character of normalised) {
    if (KEPT.test(character)) {
      current += character;
      continue;
    }
    if (current.length > 0) {
      parts.push(current);
      current = "";
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts.join("-");
}

// most specific first, because the narrowest prior that exists is the one to use
export function categoryKeys(category: string | null): string[] {
  if (category === null) {
    return [];
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const segment of category.split(TRAIL_SEPARATORS).reverse()) {
    const key = categorySlug(segment);
    if (key === "" || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}
