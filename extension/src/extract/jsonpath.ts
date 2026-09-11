export type PathSegment =
  | { type: "key"; key: string }
  | { type: "wildcard" }
  | { type: "index"; index: number };

// json-ld keys carry @ and -, so a dot key is anything but a delimiter
const DOT_KEY = /^\.([^.[\]]+)/;
const BRACKET = /^\[(?:(\*)|(\d+)|'([^']*)'|"([^"]*)")\]/;

// null means the path did not parse, which is not the same as matching nothing
export function parseJsonPath(path: string): PathSegment[] | null {
  let rest = path.startsWith("$") ? path.slice(1) : path;
  const segments: PathSegment[] = [];

  while (rest.length > 0) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function queryJsonPath(root: unknown, path: string): unknown[] {
  const segments = parseJsonPath(path);
  // a path nobody can read must not report the whole document as a match
  if (segments === null) {
    return [];
  }
  let current: unknown[] = [root];
  for (const segment of segments) {
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
    current = next;
  }
  return current;
}
