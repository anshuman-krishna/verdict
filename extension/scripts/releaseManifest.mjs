// SPEC.md section 14's bundle cap and the promise SITE.md's /install page
// and the README both already make: "every release lists the commit it was
// built from and the SHA256 of the zip, so you can check that what is in
// the store matches what is in the repository." Nothing produced that
// document, so nobody could check it.
//
// Pure on purpose. Every byte, hash, size and commit is measured by
// release-manifest.mjs and handed in, so this half is directly testable
// and the acceptance criterion lives in one place rather than being
// restated in a CI shell script.

// SPEC.md section 14: "bundle under 8 MB including the quantised embedding
// model". Measured unpacked, not zipped: the cap is about what the store
// installs and what has to load, and a zip's compression ratio would move
// the real limit around with the contents.
export const BUNDLE_BUDGET_BYTES = 8 * 1024 * 1024;

export const MANIFEST_VERSION = 1;

// a build is only checkable against the repository if it names the exact
// commit, so an unknown or dirty tree is a refusal rather than a manifest
// with a blank in it.
export function buildReleaseManifest({ version, commit, artifacts, budgetBytes = BUNDLE_BUDGET_BYTES }) {
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("release manifest needs the extension version");
  }
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`release manifest needs a full commit sha, got: ${commit}`);
  }
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error("release manifest needs at least one built artifact");
  }

  // the sources zip AMO requires is a release artifact but not an
  // installed bundle, so it carries a null unpacked size and the cap does
  // not apply to it.
  const overBudget = artifacts.filter(
    (artifact) => artifact.unpackedBytes !== null && artifact.unpackedBytes > budgetBytes,
  );
  if (overBudget.length > 0) {
    const detail = overBudget
      .map((artifact) => `${artifact.target} is ${artifact.unpackedBytes} bytes unpacked`)
      .join(", ");
    throw new Error(`over the ${budgetBytes} byte bundle budget: ${detail}`);
  }

  for (const artifact of artifacts) {
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      throw new Error(`${artifact.target} needs a sha256 of its zip, got: ${artifact.sha256}`);
    }
  }

  return {
    manifestVersion: MANIFEST_VERSION,
    version,
    commit,
    budgetBytes,
    artifacts: [...artifacts]
      .sort((a, b) => a.target.localeCompare(b.target))
      .map((artifact) => ({
        target: artifact.target,
        file: artifact.file,
        sha256: artifact.sha256,
        zipBytes: artifact.zipBytes,
        unpackedBytes: artifact.unpackedBytes,
      })),
  };
}

// what someone downloading a release runs to check the zip in their hands
// against the manifest in the repository, and what CI runs to check that a
// rebuild of the same commit still produces the same bytes. Reports every
// mismatch rather than the first, since "one file differs" and "all of them
// differ" are very different situations to be told about.
export function verifyReleaseManifest(manifest, observed) {
  const problems = [];
  const observedByFile = new Map(observed.map((artifact) => [artifact.file, artifact]));

  for (const artifact of manifest.artifacts) {
    const match = observedByFile.get(artifact.file);
    if (match === undefined) {
      problems.push(`${artifact.file} is in the manifest but was not built`);
      continue;
    }
    if (match.sha256 !== artifact.sha256) {
      problems.push(`${artifact.file} hashes to ${match.sha256}, manifest says ${artifact.sha256}`);
    }
    observedByFile.delete(artifact.file);
  }

  for (const file of observedByFile.keys()) {
    problems.push(`${file} was built but is not in the manifest`);
  }

  return problems;
}
