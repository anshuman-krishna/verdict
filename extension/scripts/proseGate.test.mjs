import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCUSATORY_WORDS,
  EM_DASH,
  accusatoryProblems,
  emDashProblems,
  isOurProse,
  isScanned,
  proseProblems,
} from "./proseGate.mjs";

function file(text, path = "extension/src/ui/panel.ts") {
  return [{ path, text }];
}

describe("the em dash ban, CLAUDE.md non negotiable 4", () => {
  it("names the file and the line", () => {
    expect(emDashProblems(file(`const a = 1;\nconst b = "one ${EM_DASH} two";`))).toEqual([
      "extension/src/ui/panel.ts:2 carries an em dash, CLAUDE.md allows none anywhere",
    ]);
  });

  it("leaves hyphens, en dashes, and minus signs alone", () => {
    expect(emDashProblems(file("a - b, c – d, e − f"))).toEqual([]);
  });

  it("holds in a test file too, since the ban is everywhere", () => {
    expect(emDashProblems(file(`"${EM_DASH}"`, "extension/src/ui/panel.test.ts")).length).toBe(1);
  });

  it("does not reach into saved storefront pages, which nobody here wrote", () => {
    expect(emDashProblems(file(EM_DASH, "extension/fixtures/b0abcdef12.html"))).toEqual([]);
  });
});

describe("the vocabulary ban, DESIGN.md section 10", () => {
  it("catches every word the design forbids", () => {
    for (const word of ACCUSATORY_WORDS) {
      expect(accusatoryProblems(file(`say "${word}" here`)).length).toBe(1);
    }
  });

  it("ignores case, because the ban is about the word", () => {
    expect(accusatoryProblems(file("A Scam, apparently")).length).toBe(1);
  });

  it("leaves a longer word that merely contains one alone", () => {
    expect(accusatoryProblems(file("scamper, defrauded, faker"))).toEqual([]);
  });

  it("lets a test assert the absence of the word it names", () => {
    expect(accusatoryProblems(file("expect(text).not.toContain('fake')", "src/a.test.ts"))).toEqual(
      [],
    );
    expect(accusatoryProblems(file("fake_store()", "service/tests/test_restore.py"))).toEqual([]);
  });

  it("still holds for prose that ships", () => {
    expect(accusatoryProblems(file("Not a fake review", "site/src/pages/index.astro")).length).toBe(
      1,
    );
  });
});

describe("what the gate looks at", () => {
  it("skips the planning folder, lock files, and binaries", () => {
    for (const path of [
      "testing/SPEC.md",
      "extension/package-lock.json",
      "service/uv.lock",
      "site/public/fonts/public-sans.woff2",
      "extension/src/assets/model.onnx",
    ]) {
      expect(isScanned(path)).toBe(false);
    }
  });

  it("treats shipped source as our own prose and tests as not", () => {
    expect(isOurProse("extension/src/ui/panel.ts")).toBe(true);
    expect(isOurProse("README.md")).toBe(true);
    expect(isOurProse("extension/src/ui/panel.test.ts")).toBe(false);
    expect(isOurProse("research/tests/test_train.py")).toBe(false);
  });

  it("reports both kinds together", () => {
    const problems = proseProblems(file(`"fake" and an ${EM_DASH}`));
    expect(problems).toHaveLength(2);
  });
});

describe("the gate over its own source", () => {
  // it went untracked while it was written, so git ls-files never handed it to itself
  it("reads clean over the files that make it up", () => {
    const here = import.meta.dirname;
    const files = ["proseGate.mjs", "prose-gate.mjs", "proseGate.test.mjs"].map((name) => ({
      path: `extension/scripts/${name}`,
      text: readFileSync(join(here, name), "utf8"),
    }));
    expect(proseProblems(files)).toEqual([]);
  });

  it("still holds the em dash ban over itself, which is the part it can keep", () => {
    expect(isScanned("extension/scripts/proseGate.mjs")).toBe(true);
    expect(isOurProse("extension/scripts/proseGate.mjs")).toBe(false);
  });
});
