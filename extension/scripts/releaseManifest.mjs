export const BUNDLE_BUDGET_BYTES = 8 * 1024 * 1024;

export const MANIFEST_VERSION = 1;

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
