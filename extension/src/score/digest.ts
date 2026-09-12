const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function toBase(value: number, length: number, alphabet: string = ALPHABET): string {
  let remaining = value;
  let result = "";
  for (let i = 0; i < length; i++) {
    result = alphabet[remaining % alphabet.length] + result;
    remaining = Math.floor(remaining / alphabet.length);
  }
  return result;
}

// short enough to read aloud off a report, not a cryptographic commitment
export function shortDigest(input: string, length = 8): string {
  return toBase(fnv1a32(input), length);
}
