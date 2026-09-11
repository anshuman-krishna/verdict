export const DEFAULT_TIMEOUT_MS = 8000;

// PRIVACY.md section 4, enforced here rather than trusted to each caller
export const ANONYMOUS_REQUEST_INIT: RequestInit = {
  credentials: "omit",
  referrer: "",
  referrerPolicy: "no-referrer",
  cache: "no-store",
  mode: "cors",
};

export async function fetchWithin(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response | null> {
  const controller = new AbortController();
  let handle: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    handle = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const response = await Promise.race([
      // the anonymous init last, so no caller can opt out of it
      fetchImpl(url, { ...init, ...ANONYMOUS_REQUEST_INIT, signal: controller.signal }),
      expired,
    ]);
    // a silent service cannot wedge us
    if (response === null) {
      controller.abort();
    }
    return response;
  } finally {
    clearTimeout(handle);
  }
}
