export const RELAY_CHANNEL = "verdict:bridge";
export const RELAY_ATTRIBUTE = "data-verdict-relay";

export const DEFAULT_TIMEOUT_MS = 10_000;
// hidden tab plus review pages
export const ANALYZE_TIMEOUT_MS = 45_000;

interface ChromeRuntime {
  sendMessage: (extensionId: string, message: unknown, callback: (response: unknown) => void) => void;
  lastError?: { message?: string };
}

export interface BridgeWindow {
  location: { origin: string };
  chrome?: { runtime?: ChromeRuntime };
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export interface BridgeRoot {
  getAttribute(name: string): string | null;
}

export interface BridgeEnvironment {
  window: BridgeWindow;
  root: BridgeRoot;
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  randomId: () => string;
}

export type Transport = "relay" | "direct" | null;

export class BridgeError extends Error {}

export function browserEnvironment(): BridgeEnvironment {
  return {
    window: window as unknown as BridgeWindow,
    root: document.documentElement,
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    randomId: () => crypto.randomUUID(),
  };
}

export function isExtensionInstalled(environment: BridgeEnvironment): boolean {
  return environment.root.getAttribute("data-verdict-installed") === "true";
}

// relay works in every browser
export function chooseTransport(environment: BridgeEnvironment): Transport {
  if (environment.root.getAttribute(RELAY_ATTRIBUTE) === "true") {
    return "relay";
  }
  const extensionId = environment.root.getAttribute("data-verdict-extension-id");
  if (extensionId && typeof environment.window.chrome?.runtime?.sendMessage === "function") {
    return "direct";
  }
  return null;
}

function unwrap(response: unknown): unknown {
  if (response === undefined || response === null) {
    throw new BridgeError("no response from the extension");
  }
  if (typeof response === "object" && typeof (response as { error?: unknown }).error === "string") {
    throw new BridgeError((response as { error: string }).error);
  }
  return response;
}

function viaRelay(environment: BridgeEnvironment, message: unknown, timeoutMs: number): Promise<unknown> {
  const { window: target } = environment;
  const id = environment.randomId();
  return new Promise((resolve, reject) => {
    const finish = (settle: () => void) => {
      environment.clearTimeout(timer);
      target.removeEventListener("message", listener);
      settle();
    };
    const listener = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (
        event.origin !== target.location.origin ||
        typeof data !== "object" ||
        data === null ||
        data.channel !== RELAY_CHANNEL ||
        data.direction !== "response" ||
        data.id !== id
      ) {
        return;
      }
      finish(() => {
        try {
          resolve(unwrap(data.response));
        } catch (error) {
          reject(error);
        }
      });
    };
    const timer = environment.setTimeout(
      () => finish(() => reject(new BridgeError("the extension did not answer in time"))),
      timeoutMs,
    );
    target.addEventListener("message", listener);
    target.postMessage({ channel: RELAY_CHANNEL, direction: "request", id, message }, target.location.origin);
  });
}

function viaDirect(environment: BridgeEnvironment, message: unknown, timeoutMs: number): Promise<unknown> {
  const runtime = environment.window.chrome?.runtime;
  const extensionId = environment.root.getAttribute("data-verdict-extension-id");
  return new Promise((resolve, reject) => {
    if (runtime === undefined || !extensionId) {
      reject(new BridgeError("no way to reach the extension in this browser"));
      return;
    }
    let settled = false;
    const timer = environment.setTimeout(() => {
      settled = true;
      reject(new BridgeError("the extension did not answer in time"));
    }, timeoutMs);
    runtime.sendMessage(extensionId, message, (response) => {
      if (settled) {
        return;
      }
      settled = true;
      environment.clearTimeout(timer);
      if (runtime.lastError) {
        reject(new BridgeError(runtime.lastError.message ?? "the extension could not be reached"));
        return;
      }
      try {
        resolve(unwrap(response));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function sendToExtension(
  type: string,
  extra: Record<string, unknown> = {},
  options: { environment?: BridgeEnvironment; timeoutMs?: number } = {},
): Promise<unknown> {
  const environment = options.environment ?? browserEnvironment();
  const timeoutMs = options.timeoutMs ?? (type === "verdict:analyze" ? ANALYZE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const message = { ...extra, type };
  switch (chooseTransport(environment)) {
    case "relay":
      return viaRelay(environment, message, timeoutMs);
    case "direct":
      return viaDirect(environment, message, timeoutMs);
    default:
      return Promise.reject(new BridgeError("no way to reach the extension in this browser"));
  }
}
