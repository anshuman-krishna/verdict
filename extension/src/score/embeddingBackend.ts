import { lexiconBytes, parseLexicon, type Lexicon } from "./lexicon";
import artifact from "./lexicon.json";
import { EMBEDDING_DIMENSIONS, embedText, normalizeVector, tokenize } from "./textEmbedding";

export const LEXICON_ARTIFACT_VERSION = 1;

export const HASHED_TERMS_IDENTITY = "hashed-terms";

export interface EmbeddingBackend {
  readonly identity: string;
  readonly dimensions: number;
  embed(text: string): number[] | null;
}

export function hashedTerms(dimensions = EMBEDDING_DIMENSIONS): EmbeddingBackend {
  return {
    identity: `${HASHED_TERMS_IDENTITY}/${dimensions}`,
    dimensions,
    embed: (text) => embedText(text, dimensions),
  };
}

export function fromLexicon(lexicon: Lexicon, identity: string): EmbeddingBackend {
  return {
    identity,
    dimensions: lexicon.dimensions,
    embed(text: string): number[] | null {
      const total = new Array<number>(lexicon.dimensions).fill(0);
      let found = 0;
      for (const token of tokenize(text)) {
        const row = lexicon.row(token);
        if (row === null) {
          continue;
        }
        found++;
        for (let i = 0; i < lexicon.dimensions; i++) {
          total[i] = (total[i] as number) + (row[i] as number);
        }
      }
      if (found === 0) {
        return null;
      }
      return normalizeVector(total);
    },
  };
}

// an absent or unreadable table is a table this build does not have, and a build without one
// still has to score, so the caller is handed the hashed terms rather than nothing
export function backendFromArtifact(data: unknown, fallback = hashedTerms()): EmbeddingBackend {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return fallback;
  }
  const record = data as Record<string, unknown>;
  if (record.artifactVersion !== LEXICON_ARTIFACT_VERSION || record.present !== true) {
    return fallback;
  }
  const { identity, bytes } = record;
  if (typeof identity !== "string" || identity.length === 0 || typeof bytes !== "string") {
    return fallback;
  }
  const decoded = lexiconBytes(bytes);
  if (decoded === null) {
    return fallback;
  }
  const lexicon = parseLexicon(decoded);
  if (lexicon === null) {
    return fallback;
  }
  return fromLexicon(lexicon, identity);
}

let bundled: EmbeddingBackend | null = null;

// decoding the table costs megabytes of work, so it happens once per document
export function bundledEmbeddingBackend(): EmbeddingBackend {
  bundled ??= backendFromArtifact(artifact);
  return bundled;
}
