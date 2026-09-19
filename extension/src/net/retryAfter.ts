// a service under load says when to come back. it is not trusted to say "never", so the
// longest hold it can ask for is a day, and a header that makes no sense is no header
export const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

// what a refusal that said nothing is treated as, matching the service's own retry after
export const DEFAULT_RETRY_AFTER_MS = 60 * 60 * 1000;

const SECONDS = /^\d+$/;

// rfc 9110 imf-fixdate, the one form a server is required to send. anything looser lets
// Date.parse read "1.5" as a date and call it a wait
const HTTP_DATE =
  /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

export function retryAfterMs(header: string | null | undefined, now: number): number | null {
  if (header === null || header === undefined) {
    return null;
  }
  const trimmed = header.trim();
  if (SECONDS.test(trimmed)) {
    return clamp(Number(trimmed) * 1000);
  }
  if (!HTTP_DATE.test(trimmed)) {
    return null;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) {
    return null;
  }
  return clamp(at - now);
}

export function holdUntil(header: string | null | undefined, now: number): number {
  return now + (retryAfterMs(header, now) ?? DEFAULT_RETRY_AFTER_MS);
}

function clamp(ms: number): number {
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}
