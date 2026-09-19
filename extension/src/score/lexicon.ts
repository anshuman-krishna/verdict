export const LEXICON_MAGIC = "VLEX";
export const LEXICON_VERSION = 1;
export const LEXICON_HEADER_BYTES = 20;

const MAGIC_BYTES = [0x56, 0x4c, 0x45, 0x58];

export interface Lexicon {
  readonly version: number;
  readonly dimensions: number;
  readonly scale: number;
  readonly tokenCount: number;
  row(token: string): number[] | null;
}

export function parseLexicon(bytes: Uint8Array): Lexicon | null {
  if (bytes.length < LEXICON_HEADER_BYTES) {
    return null;
  }
  for (const [i, byte] of MAGIC_BYTES.entries()) {
    if (bytes[i] !== byte) {
      return null;
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  const dimensions = view.getUint16(6, true);
  const tokenCount = view.getUint32(8, true);
  const scale = view.getFloat32(12, true);
  const tokenBytes = view.getUint32(16, true);
  if (version !== LEXICON_VERSION || dimensions === 0 || tokenCount === 0 || scale <= 0) {
    return null;
  }

  const rowsAt = LEXICON_HEADER_BYTES + tokenBytes;
  const expected = rowsAt + tokenCount * dimensions;
  if (bytes.length !== expected) {
    return null;
  }

  const names = decodeUtf8(bytes.subarray(LEXICON_HEADER_BYTES, rowsAt)).split("\n");
  if (names.length !== tokenCount) {
    return null;
  }
  const index = new Map<string, number>();
  for (const [position, name] of names.entries()) {
    if (name.length === 0 || index.has(name)) {
      return null;
    }
    index.set(name, position);
  }

  const rows = new Int8Array(bytes.buffer, bytes.byteOffset + rowsAt, tokenCount * dimensions);
  return {
    version,
    dimensions,
    scale,
    tokenCount,
    row(token: string): number[] | null {
      const position = index.get(token);
      if (position === undefined) {
        return null;
      }
      const start = position * dimensions;
      const values = new Array<number>(dimensions);
      for (let i = 0; i < dimensions; i++) {
        values[i] = (rows[start + i] as number) * scale;
      }
      return values;
    },
  };
}

export function lexiconBytes(base64: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
