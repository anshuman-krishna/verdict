import { canonicalJson } from "../src/extract/canonicalJson.ts";
import { sanitiseRulesDocument } from "../src/extract/validateRules.ts";

// the checks that decide whether a rules document is publishable, kept
// apart from the signing itself so they can be tested without a keypair.
//
// These import the extension's own modules directly rather than
// reimplementing them. node reads the type annotations off a .ts file and
// runs it, which is why this is possible at all, and it is worth the
// dependency on that: a second copy of either the canonical encoding or the
// validator would drift, and a drift in the first one silently invalidates
// every signature the extension has ever been asked to check.

// the loader is deliberately forgiving about what it accepts: a field it
// cannot use is dropped so the rest of a document still delivers its fixes.
// A publisher has no reason to be forgiving about what it sends. Signing a
// document with a field that will be discarded on arrival is shipping a fix
// that silently does not apply, so it is refused here.
export function publishProblems(document, previouslyPublishedVersion) {
  const problems = [];
  const sanitised = sanitiseRulesDocument(document);
  if (sanitised === null) {
    problems.push("this is not a rules document the extension would accept at all");
    return problems;
  }
  for (const problem of sanitised.problems) {
    problems.push(`the extension would discard ${problem}`);
  }
  if (Object.keys(sanitised.rules.fields).length === 0) {
    problems.push("no fields, so this document would extract nothing");
  }
  // rulesLoader.ts refuses a remote document older than the one it already
  // trusts, so republishing at or below the version already served is a fix
  // that looks published and never applies. The comparison is against what
  // is actually on the site, which is knowable, rather than against the
  // bundled version, which is whatever the last store release happened to
  // carry and is not.
  if (
    typeof previouslyPublishedVersion === "number" &&
    document.version <= previouslyPublishedVersion
  ) {
    problems.push(
      `version ${document.version} is not above the published version ` +
        `${previouslyPublishedVersion}, so no extension would replace what it already has`,
    );
  }
  return problems;
}

export function buildEnvelope(document, signature) {
  return { rules: document, signature };
}

export { canonicalJson };
