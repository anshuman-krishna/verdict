export type Comparison = "exists" | "eq" | "ne";

export type FilterLiteral = string | number | boolean | null;

export type PathSegment =
  | { type: "key"; key: string }
  | { type: "wildcard" }
  | { type: "index"; index: number }
  | { type: "descend" }
  | { type: "filter"; key: string; comparison: Comparison; literal?: FilterLiteral };

// json-ld keys carry @ and -, so a dot key is anything but a delimiter
const DOT_KEY = /^\.([^.[\]]+)/;
const BRACKET = /^\[(?:(\*)|(\d+)|'([^']*)'|"([^"]*)")\]/;

// only equality against a literal, because a predicate that can compute is a
// remote expression language and manifest v3 forbids one
const FILTER =
  /^\[\?\(\s*@(?:\.([^\s.[\]()=!<>&|+*\/%'"]+)|\['([^']*)'\]|\["([^"]*)"\])\s*(?:(==|!=)\s*('[^']*'|"[^"]*"|-?\d+(?:\.\d+)?|true|false|null)\s*)?\)\]/;

// a descent over a deeply nested document is the one unbounded walk here. only
// containers count, since they are what carries the cost and what a filter can match
const MAX_VISITED_CONTAINERS = 50_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContainer(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function parseLiteral(raw: string): FilterLiteral {
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  if (raw === "null") {
    return null;
  }
  const quote = raw[0];
  if (quote === "'" || quote === '"') {
    return raw.slice(1, -1);
  }
  return Number(raw);
}

// null means the path did not parse, which is not the same as matching nothing
export function parseJsonPath(path: string): PathSegment[] | null {
  let rest = path.startsWith("$") ? path.slice(1) : path;
  const segments: PathSegment[] = [];

  while (rest.length > 0) {
    if (rest.startsWith("..")) {
      segments.push({ type: "descend" });
      // a trailing .. names every descendant, which is a match set of its own
      if (rest === "..") {
        return segments;
      }
      rest = rest.startsWith("..[") ? rest.slice(2) : rest.slice(1);
      continue;
    }
    const filter = FILTER.exec(rest);
    if (filter !== null) {
      const [, dotted, singleQuoted, doubleQuoted, operator, literal] = filter;
      const key = (dotted ?? singleQuoted ?? doubleQuoted) as string;
      segments.push(
        operator === undefined
          ? { type: "filter", key, comparison: "exists" }
          : {
              type: "filter",
              key,
              comparison: operator === "==" ? "eq" : "ne",
              literal: parseLiteral(literal as string),
            },
      );
      rest = rest.slice(filter[0].length);
      continue;
    }
    const dot = DOT_KEY.exec(rest);
    if (dot !== null) {
      segments.push({ type: "key", key: dot[1] as string });
      rest = rest.slice(dot[0].length);
      continue;
    }
    const bracket = BRACKET.exec(rest);
    if (bracket !== null) {
      const [, wildcard, index, singleQuoted, doubleQuoted] = bracket;
      if (wildcard !== undefined) {
        segments.push({ type: "wildcard" });
      } else if (index !== undefined) {
        segments.push({ type: "index", index: Number(index) });
      } else {
        segments.push({ type: "key", key: (singleQuoted ?? doubleQuoted) as string });
      }
      rest = rest.slice(bracket[0].length);
      continue;
    }
    return null;
  }
  return segments;
}

function descendants(roots: readonly unknown[]): unknown[] {
  const found: unknown[] = [];
  const seen = new Set<unknown>();
  const pending: unknown[] = [...roots];
  let next = 0;
  let visited = 0;
  // an index rather than shift, so a document with many reviews stays linear
  while (next < pending.length && visited < MAX_VISITED_CONTAINERS) {
    const value = pending[next];
    next += 1;
    if (isContainer(value)) {
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      visited += 1;
      if (Array.isArray(value)) {
        pending.push(...value);
      } else if (isRecord(value)) {
        pending.push(...Object.values(value));
      }
    }
    found.push(value);
  }
  return found;
}

function equals(value: unknown, literal: FilterLiteral): boolean {
  // json-ld writes @type as a string or as a list of them
  if (Array.isArray(value)) {
    return value.some((entry) => entry === literal);
  }
  return value === literal;
}

function matchesFilter(value: unknown, segment: Extract<PathSegment, { type: "filter" }>): boolean {
  if (!isRecord(value) || !Object.hasOwn(value, segment.key)) {
    return segment.comparison === "ne";
  }
  const held = value[segment.key];
  if (segment.comparison === "exists") {
    return held !== undefined && held !== null;
  }
  const same = equals(held, segment.literal as FilterLiteral);
  return segment.comparison === "eq" ? same : !same;
}

function applyFilter(
  current: readonly unknown[],
  segment: Extract<PathSegment, { type: "filter" }>,
): unknown[] {
  const next: unknown[] = [];
  for (const value of current) {
    // an array is filtered element by element, an object stands or falls itself
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      if (matchesFilter(candidate, segment)) {
        next.push(candidate);
      }
    }
  }
  return next;
}

// a descent visits a node by several routes, and a node is one match however it was reached
function withoutRepeatedContainers(values: readonly unknown[]): unknown[] {
  const seen = new Set<unknown>();
  const kept: unknown[] = [];
  for (const value of values) {
    if (isContainer(value)) {
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
    }
    kept.push(value);
  }
  return kept;
}

export function queryJsonPath(root: unknown, path: string): unknown[] {
  const segments = parseJsonPath(path);
  // a path nobody can read must not report the whole document as a match
  if (segments === null) {
    return [];
  }
  let current: unknown[] = [root];
  for (const segment of segments) {
    if (segment.type === "descend") {
      current = descendants(current);
      continue;
    }
    if (segment.type === "filter") {
      current = withoutRepeatedContainers(applyFilter(current, segment));
      continue;
    }
    const next: unknown[] = [];
    for (const value of current) {
      if (segment.type === "key") {
        // own properties only, so a path cannot walk into the prototype chain
        if (isRecord(value) && Object.hasOwn(value, segment.key)) {
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
    current = withoutRepeatedContainers(next);
  }
  return current;
}
