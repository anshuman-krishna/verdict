import { canonicalJson } from "../src/extract/canonicalJson.ts";
import { sanitiseRulesDocument } from "../src/extract/validateRules.ts";


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
