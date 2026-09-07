import document from "./rules/amazon.json";
import type { RulesDocument } from "./rules";

// SPEC.md section 9's rules document, as the one file it should be. It was
// a TypeScript literal here, which meant a selector fix was a code change
// and the document that ships inside the bundle was a different artefact
// from the one scripts/sign-rules.mjs publishes. Now it is one json file
// with two delivery paths: bundled at build time, and signed and served
// from the site for the same fix to land within the day
// (extract/remoteRules.ts, extract/rulesLoader.ts).
//
// The field rules themselves depend on real amazon page structure, checked
// against the fixture corpus in PLAN.md week 1 tasks 2 and 5. That corpus
// is hand built and does not exist yet, so "fields" stays empty rather than
// guessing at selectors nothing has verified against a real page. Site and
// locales are SPEC.md section 9's own example, safe to ship now since
// resolveField degrades to an empty match on any unset field instead of
// throwing.
//
// Version 0 is deliberate: extract/rulesLoader.ts only accepts a remote
// document whose version is at least the bundled one, so the first real
// rules document published can be version 1 and win.
export const BUNDLED_AMAZON_RULES: RulesDocument = document as RulesDocument;
