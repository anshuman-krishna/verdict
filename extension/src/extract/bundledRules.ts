import document from "./rules/amazon.json";
import type { RulesDocument } from "./rules";

// one json file with two delivery paths: bundled at build time, and signed and served for a same
// day fix. fields stays empty until the fixture corpus can verify selectors against a real page.
// version 0 so the first published document can be version 1 and win
export const BUNDLED_AMAZON_RULES: RulesDocument = document as RulesDocument;
