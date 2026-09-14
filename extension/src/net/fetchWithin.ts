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

// one deadline over headers and body, a trickled body cannot hang the caller
export async function fetchJsonWithin(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<JsonReply | null> {
  const controller = new AbortController();
  const { expired, cancel } = deadline(timeoutMs);
  const exchange = startFetch(fetchImpl, url, init, controller.signal).then(
    async (response): Promise<JsonReply> => {
      if (!response.ok) {
        return { ok: false, status: response.status, body: null };
      }
      return { ok: true, status: response.status, body: await response.json() };
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
