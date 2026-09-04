type PathSegment =
  | { type: "key"; key: string }
  | { type: "wildcard" }
  | { type: "index"; index: number };

const TOKEN_PATTERN = /\.([a-zA-Z0-9_]+)|\[(\*|\d+)\]/g;

export function parseJsonPath(path: string): PathSegment[] {
  const body = path.startsWith("$") ? path.slice(1) : path;
  const segments: PathSegment[] = [];
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const [, key, bracket] = match;
    if (key !== undefined) {
      segments.push({ type: "key", key });
    } else if (bracket === "*") {
      segments.push({ type: "wildcard" });
    } else if (bracket !== undefined) {
      segments.push({ type: "index", index: Number(bracket) });
    }
  }
  return segments;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// resolves a small dot/bracket subset of JSONPath ($.a.b, $.a[*], $.a[2].b)
// against a parsed JSON value, always returning an array of matches.
export function queryJsonPath(root: unknown, path: string): unknown[] {
  let current: unknown[] = [root];
  for (const segment of parseJsonPath(path)) {
    const next: unknown[] = [];
    for (const value of current) {
      if (segment.type === "key") {
        if (isRecord(value) && segment.key in value) {
          next.push(value[segment.key]);
        }
      } else if (segment.type === "index") {
        if (Array.isArray(value) && segment.index < value.length) {
          next.push(value[segment.index]);
        }
      } else if (Array.isArray(value)) {
        next.push(...value);
      }
    }
    current = next;
  }
  return current;
}
