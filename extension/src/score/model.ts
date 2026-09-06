import type { CombinerModel } from "./combine";

// SPEC.md section 6, "the output artefact is model.json", trained by the
// research pipeline in PLAN.md week 5, which needs the ground truth corpus
// from week 4. Neither exists yet, and CLAUDE.md reserves the calibration
// target to anshuman, so this file never fabricates coefficients or a
// calibration curve to fill the gap.
//
// BUNDLED_MODEL is null until a real model.json is exported and wired in at
// build time. Every caller must treat null as "no score can be computed
// yet" (buildReport.ts returns { status: "no-model" }), never as "assume
// zero risk" or any other invented default.
export const BUNDLED_MODEL: CombinerModel | null = null;
