export const DEFAULT_TIMEOUT_MS = 8000;

// PRIVACY.md section 4, enforced here rather than trusted to each caller
export const ANONYMOUS_REQUEST_INIT: RequestInit = {
  credentials: "omit",
  referrer: "",
  referrerPolicy: "no-referrer",
  cache: "no-store",
  mode: "cors",
};

function deadline(timeoutMs: number): { expired: Promise<null>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    handle = setTimeout(() => resolve(null), Math.max(0, timeoutMs));
  });
  return { expired, cancel: () => clearTimeout(handle) };
}

function startFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  // the anonymous init last, so no caller can opt out of it
  const request = Promise.resolve().then(() =>
    fetchImpl(url, { ...init, ...ANONYMOUS_REQUEST_INIT, signal }),
  );
  // an abandoned request rejects later with nobody listening
  request.catch(() => undefined);
  return request;
}

export async function fetchWithin(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response | null> {
  const controller = new AbortController();
  const { expired, cancel } = deadline(timeoutMs);
  try {
    const response = await Promise.race([
      startFetch(fetchImpl, url, init, controller.signal),
      expired,
    ]);
    // a silent service cannot wedge us
    if (response === null) {
      controller.abort();
    }
    return response;
  } finally {
    cancel();
  }
}

export interface JsonReply {
  ok: boolean;
  status: number | undefined;
  body: unknown;
}

// a deadline bounds how long a body may take, not how large it may be, and the
// worker has far less memory than a page does
export const MAX_RESPONSE_BYTES = 1024 * 1024;

async function readWithin(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let read = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        return text + decoder.decode();
      }
      read += chunk.value.byteLength;
      if (read > maxBytes) {
        throw new Error(`response body over ${maxBytes} bytes`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

async function jsonWithin(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers?.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`response body over ${maxBytes} bytes`);
  }
  // only a stub has no stream, and a stub is not what the ceiling is for
  if (!response.body) {
    return await response.json();
  }
  return JSON.parse(await readWithin(response.body, maxBytes));
}

// one deadline over headers and body, a trickled body cannot hang the caller
export async function fetchJsonWithin(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  maxBytes: number = MAX_RESPONSE_BYTES,
): Promise<JsonReply | null> {
  const controller = new AbortController();
  const { expired, cancel } = deadline(timeoutMs);
  const exchange = startFetch(fetchImpl, url, init, controller.signal).then(
    async (response): Promise<JsonReply> => {
      if (!response.ok) {
        return { ok: false, status: response.status, body: null };
      }
      return { ok: true, status: response.status, body: await jsonWithin(response, maxBytes) };
    },
  );
  exchange.catch(() => undefined);
  try {
    const reply = await Promise.race([exchange, expired]);
    if (reply === null) {
      controller.abort();
    }
    return reply;
  } finally {
    cancel();
  }
}
