import { deleteContributions, listDueContributions } from "./queue";

export interface FlushDeps {
  endpoint: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface FlushResult {
  submitted: number;
}

// PRIVACY.md section 5: "Submissions are batched... and sent without any
// client identifier, so a submission cannot be tied to a browsing
// session." Every currently due edge goes in one request body, no
// cookie, no header beyond content-type, and nothing about which browser
// or install sent it. Never throws: a failed submission leaves the
// batch queued for the next alarm to retry, the same "network failure
// degrades, it does not break anything" rule as reputation/client.ts.
export async function flushDueContributions(deps: FlushDeps): Promise<FlushResult> {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const due = await listDueContributions(now());
  if (due.length === 0) {
    return { submitted: 0 };
  }

  try {
    const response = await fetchImpl(deps.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ edges: due.map((item) => item.edge) }),
    });
    if (!response.ok) {
      return { submitted: 0 };
    }
  } catch {
    return { submitted: 0 };
  }

  await deleteContributions(due.map((item) => item.id));
  return { submitted: due.length };
}
