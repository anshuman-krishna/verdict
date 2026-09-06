import { describe, expect, it } from "vitest";
import {
  BUNDLE_BUDGET_BYTES,
  buildReleaseManifest,
  verifyReleaseManifest,
} from "./releaseManifest.mjs";

const COMMIT = "a".repeat(40);
const CHROME_HASH = "1".repeat(64);
const FIREFOX_HASH = "2".repeat(64);

function artifact(overrides = {}) {
  return {
    target: "chrome-mv3",
    file: "verdict-0.1.0-chrome.zip",
    sha256: CHROME_HASH,
    zipBytes: 1000,
    unpackedBytes: 4000,
    ...overrides,
  };
}

describe("buildReleaseManifest", () => {
  it("records the commit and the sha256 of every zip", () => {
    const manifest = buildReleaseManifest({
      version: "0.1.0",
      commit: COMMIT,
      artifacts: [artifact()],
    });
    expect(manifest.commit).toBe(COMMIT);
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.artifacts).toEqual([
      {
        target: "chrome-mv3",
        file: "verdict-0.1.0-chrome.zip",
        sha256: CHROME_HASH,
        zipBytes: 1000,
        unpackedBytes: 4000,
      },
    ]);
  });

  it("orders artifacts by target so a rebuild produces the same document", () => {
    const manifest = buildReleaseManifest({
      version: "0.1.0",
      commit: COMMIT,
      artifacts: [
        artifact({ target: "firefox-mv2", file: "b.zip", sha256: FIREFOX_HASH }),
        artifact({ target: "chrome-mv3", file: "a.zip" }),
      ],
    });
    expect(manifest.artifacts.map((entry) => entry.target)).toEqual(["chrome-mv3", "firefox-mv2"]);
  });

  // SPEC.md section 14: "bundle under 8 MB including the quantised
  // embedding model". This is the one place that number is enforced.
  it("refuses a build over the 8 mb bundle budget", () => {
    expect(() =>
      buildReleaseManifest({
        version: "0.1.0",
        commit: COMMIT,
        artifacts: [artifact({ unpackedBytes: BUNDLE_BUDGET_BYTES + 1 })],
      }),
    ).toThrow(/bundle budget/);
  });

  it("accepts a build exactly on the budget", () => {
    expect(() =>
      buildReleaseManifest({
        version: "0.1.0",
        commit: COMMIT,
        artifacts: [artifact({ unpackedBytes: BUNDLE_BUDGET_BYTES })],
      }),
    ).not.toThrow();
  });

  // the sources zip AMO asks for is a release artifact but not an
  // installed bundle, so the cap does not apply to it.
  it("exempts an artifact with no unpacked size from the budget", () => {
    expect(() =>
      buildReleaseManifest({
        version: "0.1.0",
        commit: COMMIT,
        artifacts: [
          artifact(),
          artifact({
            target: "sources",
            file: "verdict-0.1.0-sources.zip",
            sha256: FIREFOX_HASH,
            unpackedBytes: null,
          }),
        ],
      }),
    ).not.toThrow();
  });

  it("names every artifact that is over budget, not just the first", () => {
    expect(() =>
      buildReleaseManifest({
        version: "0.1.0",
        commit: COMMIT,
        artifacts: [
          artifact({ target: "chrome-mv3", unpackedBytes: BUNDLE_BUDGET_BYTES + 1 }),
          artifact({ target: "firefox-mv2", sha256: FIREFOX_HASH, unpackedBytes: BUNDLE_BUDGET_BYTES + 2 }),
        ],
      }),
    ).toThrow(/chrome-mv3.*firefox-mv2/);
  });

  // a manifest whose commit is missing or abbreviated cannot be used to
  // check a download against the repository, which is the only reason it
  // exists.
  it("refuses anything but a full commit sha", () => {
    for (const commit of ["", "abc1234", "A".repeat(40), undefined]) {
      expect(() =>
        buildReleaseManifest({ version: "0.1.0", commit, artifacts: [artifact()] }),
      ).toThrow(/commit sha/);
    }
  });

  it("refuses a build with no artifacts and a version with no value", () => {
    expect(() => buildReleaseManifest({ version: "0.1.0", commit: COMMIT, artifacts: [] })).toThrow(
      /at least one built artifact/,
    );
    expect(() => buildReleaseManifest({ version: "", commit: COMMIT, artifacts: [artifact()] })).toThrow(
      /extension version/,
    );
  });

  it("refuses an artifact whose hash is not a sha256", () => {
    expect(() =>
      buildReleaseManifest({
        version: "0.1.0",
        commit: COMMIT,
        artifacts: [artifact({ sha256: "not-a-hash" })],
      }),
    ).toThrow(/sha256/);
  });
});

describe("verifyReleaseManifest", () => {
  const manifest = buildReleaseManifest({
    version: "0.1.0",
    commit: COMMIT,
    artifacts: [
      artifact(),
      artifact({ target: "firefox-mv2", file: "verdict-0.1.0-firefox.zip", sha256: FIREFOX_HASH }),
    ],
  });

  it("reports nothing when every zip hashes to what the manifest recorded", () => {
    expect(verifyReleaseManifest(manifest, manifest.artifacts)).toEqual([]);
  });

  it("reports a zip whose bytes changed", () => {
    const observed = manifest.artifacts.map((entry) =>
      entry.target === "chrome-mv3" ? { ...entry, sha256: "9".repeat(64) } : entry,
    );
    expect(verifyReleaseManifest(manifest, observed)).toEqual([
      `verdict-0.1.0-chrome.zip hashes to ${"9".repeat(64)}, manifest says ${CHROME_HASH}`,
    ]);
  });

  it("reports a zip the manifest lists but the build did not produce", () => {
    const observed = manifest.artifacts.filter((entry) => entry.target === "chrome-mv3");
    expect(verifyReleaseManifest(manifest, observed)).toEqual([
      "verdict-0.1.0-firefox.zip is in the manifest but was not built",
    ]);
  });

  it("reports a zip the build produced that the manifest does not list", () => {
    const observed = [...manifest.artifacts, { file: "verdict-0.1.0-safari.zip", sha256: "3".repeat(64) }];
    expect(verifyReleaseManifest(manifest, observed)).toEqual([
      "verdict-0.1.0-safari.zip was built but is not in the manifest",
    ]);
  });
});
