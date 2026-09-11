import { getGraphContributionEnabled } from "../storage/settings";
import { fetchWithin } from "../net/fetchWithin";
import { clearContributionQueue, deleteContributions, listDueContributions } from "./queue";

export interface FlushDeps {
  endpoint: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  isEnabled?: () => Promise<boolean>;
  clearQueue?: () => Promise<void>;
}

export interface FlushResult {
  submitted: number;
}

export async function flushDueContributions(deps: FlushDeps): Promise<FlushResult> {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const isEnabled = deps.isEnabled ?? getGraphContributionEnabled;

  // the switch is checked at send time, not only at queue time
  if (!(await isEnabled())) {
    await (deps.clearQueue ?? clearContributionQueue)();
    return { submitted: 0 };
  }

  const due = await listDueContributions(now());
  if (due.length === 0) {
    return { submitted: 0 };
  }

  try {
    const response = await fetchWithin(
      fetchImpl,
      deps.endpoint,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ edges: due.map((item) => item.edge) }),
      },
      deps.timeoutMs,
    );
    if (response === null || !response.ok) {
      return { submitted: 0 };
    }
  } catch {
    return { submitted: 0 };
  }

  await deleteContributions(due.map((item) => item.id));
  return { submitted: due.length };
}
