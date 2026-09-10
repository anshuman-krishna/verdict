import { fetchWithin } from "../net/fetchWithin";
import { deleteContributions, listDueContributions } from "./queue";

export interface FlushDeps {
  endpoint: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export interface FlushResult {
  submitted: number;
}

export async function flushDueContributions(deps: FlushDeps): Promise<FlushResult> {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;

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
