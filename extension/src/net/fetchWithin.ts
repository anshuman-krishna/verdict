export const DEFAULT_TIMEOUT_MS = 8000;

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
      fetchImpl(url, { ...init, signal: controller.signal }),
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
