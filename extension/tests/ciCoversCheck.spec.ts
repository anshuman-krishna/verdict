import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const JUSTFILE = read("../../justfile");
const CI = read("../../.github/workflows/ci.yml");

// `check: (ext "build") (py "lint") parity` becomes ["ext build", "py lint", "parity"]
function checkSteps(justfile: string): string[] {
  const line = justfile.split("\n").find((candidate) => candidate.startsWith("check:"));
  if (line === undefined) {
    return [];
  }
  const dependencies = line.slice("check:".length);
  return [...dependencies.matchAll(/\((\w+)\s+"([^"]+)"\)|([\w-]+)/g)].map((match) =>
    match[3] ?? `${match[1]} ${match[2]}`,
  );
}

describe("the ci workflow runs what just check runs", () => {
  it("reads the gate's steps off the justfile", () => {
    expect(checkSteps('check: (ext "build") (py "lint") parity prose\n')).toEqual([
      "ext build",
      "py lint",
      "parity",
      "prose",
    ]);
  });

  it.each(checkSteps(JUSTFILE))("runs just %s", (step) => {
    expect(CI).toMatch(new RegExp(`run:\\s*just ${step}\\b`));
  });

  it("finds a gate to compare against", () => {
    expect(checkSteps(JUSTFILE).length).toBeGreaterThan(0);
  });
});
