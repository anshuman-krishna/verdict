import type { ReportOutcome } from "../score/buildReport";
import { listingIdentity } from "./navigation";
import type { AnalysisResult } from "./orchestrator";
import type { ProgressiveMount } from "./mount";

// a soft navigation replaces the dom when it pleases, so reading once is reading too early
export const SETTLE_MS = 300;
export const RETRY_DELAYS_MS: readonly number[] = [600, 1200];

export interface SessionDeps {
  // takes the mount so first paint can happen while the analysis is still running
  analyse: (href: string, mount: ProgressiveMount) => Promise<AnalysisResult | null>;
  createMount: () => ProgressiveMount;
  teardown: () => void;
  report: (outcome: ReportOutcome | null) => void;
  delay?: (ms: number) => Promise<void>;
  settleMs?: number;
  retryDelaysMs?: readonly number[];
}

export interface VisitOptions {
  // the first read after document_idle needs no settling, a soft navigation does
  settleMs?: number;
}

export interface Session {
  visit: (href: string, options?: VisitOptions) => Promise<void>;
}

function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// unreadable right after a navigation usually means the page has not swapped yet
function worthRetrying(result: AnalysisResult | null): boolean {
  return result === null || result.outcome.status === "unreadable";
}

export function createSession(deps: SessionDeps): Session {
  const delay = deps.delay ?? realDelay;
  const settleMs = deps.settleMs ?? SETTLE_MS;
  const retryDelaysMs = deps.retryDelaysMs ?? RETRY_DELAYS_MS;

  let identity: string | null | undefined;
  let generation = 0;

  const visit = async (href: string, options: VisitOptions = {}): Promise<void> => {
    const next = listingIdentity(href);
    // the same listing with a different query string is not a new check
    if (identity !== undefined && next === identity) {
      return;
    }
    identity = next;

    generation += 1;
    const mine = generation;
    // whatever is on screen describes the listing we just left
    deps.teardown();

    const current = (): boolean => generation === mine;

    let waited = 0;
    for (const settle of [options.settleMs ?? settleMs, ...retryDelaysMs]) {
      if (settle > 0) {
        await delay(settle);
      }
      if (!current()) {
        return;
      }
      const mount = deps.createMount();
      let result: AnalysisResult | null = null;
      try {
        result = await deps.analyse(href, mount);
      } catch {
        result = null;
      }
      if (!current()) {
        return;
      }
      if (worthRetrying(result) && waited < retryDelaysMs.length) {
        waited += 1;
        // an attempt that read nothing must not leave its notice behind
        deps.teardown();
        continue;
      }
      mount.settle();
      deps.report(result?.outcome ?? null);
      return;
    }
  };

  return { visit };
}
