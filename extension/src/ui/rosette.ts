import { BAND_COLORS, type Band } from "../score/report";

// DESIGN.md section 7: "every report draws a guilloche rosette generated
// from the feature vector itself. two harmonics whose frequency ratio comes
// from the burst and duplication scores, an amplitude from the estimated
// inorganic share, and a stroke colour from the band." the exact mapping
// from those three inputs to harmonic numbers and amplitude is not spelled
// out there, so the constants below are claude's proposal, not a ratified
// spec line.

export interface RosetteInput {
  burstShare: number;
  duplicateShare: number;
  estimatedInorganicShare: number;
  band: Band;
}

export interface RosetteParams {
  harmonicA: number;
  harmonicB: number;
  amplitude: number;
  strokeColor: string;
}

const BASE_HARMONIC = 3;
const MAX_HARMONIC_SPREAD = 4;
const MIN_AMPLITUDE = 0.15;
const MAX_AMPLITUDE = 0.8;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function rosetteParams(input: RosetteInput): RosetteParams {
  const burstShare = clamp01(input.burstShare);
  const duplicateShare = clamp01(input.duplicateShare);
  const inorganicShare = clamp01(input.estimatedInorganicShare);

  const harmonicA = BASE_HARMONIC + Math.round(burstShare * MAX_HARMONIC_SPREAD);
  const harmonicB = harmonicA + 1 + Math.round(duplicateShare * MAX_HARMONIC_SPREAD);
  const amplitude = MIN_AMPLITUDE + (MAX_AMPLITUDE - MIN_AMPLITUDE) * inorganicShare;

  return {
    harmonicA,
    harmonicB,
    amplitude,
    strokeColor: BAND_COLORS[input.band],
  };
}

// samples a two harmonic epicycloid style curve and returns an svg path's
// "d" attribute. radius is in the same units as the eventual viewBox.
export function rosettePath(params: RosetteParams, radius: number, samples = 240): string {
  const sampleCount = Math.max(1, samples);
  const points: [number, number][] = [];
  for (let i = 0; i <= sampleCount; i++) {
    const t = (i / sampleCount) * Math.PI * 2;
    const r =
      radius * (1 + params.amplitude * (Math.cos(params.harmonicA * t) - Math.cos(params.harmonicB * t)) / 2);
    points.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  const [first, ...rest] = points;
  if (first === undefined) {
    return "";
  }
  const commands = [`M ${first[0].toFixed(3)} ${first[1].toFixed(3)}`];
  for (const [x, y] of rest) {
    commands.push(`L ${x.toFixed(3)} ${y.toFixed(3)}`);
  }
  commands.push("Z");
  return commands.join(" ");
}
