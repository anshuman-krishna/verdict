// CLAUDE.md non negotiables 4 and 6, and DESIGN.md section 10. Both were held
// only by the modules that remembered to test themselves, so a new panel string
// or a new page of copy could break either without anything noticing.

// written as an escape, because a gate that bans a character cannot contain it
export const EM_DASH = "—";

// the vocabulary is a legal position as much as a tone of voice, so it is banned
// in anything that ships rather than only in what a user reads today
export const ACCUSATORY_WORDS = ["fake", "fraud", "scam", "lying"];

const ACCUSATORY_PATTERN = new RegExp(`\\b(${ACCUSATORY_WORDS.join("|")})\\b`, "i");

// saved storefront pages are ground truth and carry whatever the seller wrote;
// dependency manifests name packages nobody here chose
const NEVER_SCANNED = [
  /^testing\//,
  /(^|\/)fixtures\//,
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)uv\.lock$/,
  /\.(png|svg|ico|woff2?|onnx|jsonl|parquet)$/,
  /^\.DS_Store$|(\/)\.DS_Store$/,
];

// a test naming the vocabulary is asserting its absence, which is the point
const NOT_OUR_PROSE = [/\.(test|spec)\.[cm]?[jt]sx?$/, /(^|\/)tests?\//];

export function isScanned(path) {
  return !NEVER_SCANNED.some((pattern) => pattern.test(path));
}

export function isOurProse(path) {
  return isScanned(path) && !NOT_OUR_PROSE.some((pattern) => pattern.test(path));
}

function linesOf(text) {
  return text.split("\n");
}

export function emDashProblems(files) {
  const problems = [];
  for (const { path, text } of files) {
    if (!isScanned(path)) {
      continue;
    }
    linesOf(text).forEach((line, index) => {
      if (line.includes(EM_DASH)) {
        problems.push(`${path}:${index + 1} carries an em dash, CLAUDE.md allows none anywhere`);
      }
    });
  }
  return problems;
}

export function accusatoryProblems(files) {
  const problems = [];
  for (const { path, text } of files) {
    if (!isOurProse(path)) {
      continue;
    }
    linesOf(text).forEach((line, index) => {
      const found = ACCUSATORY_PATTERN.exec(line);
      if (found !== null) {
        problems.push(
          `${path}:${index + 1} says "${found[1]}", and DESIGN.md section 10 keeps the language statistical`,
        );
      }
    });
  }
  return problems;
}

export function proseProblems(files) {
  return [...emDashProblems(files), ...accusatoryProblems(files)];
}
