// the same guilloche curve the extension panel draws
// (extension/src/ui/rosette.ts), kept as its own small implementation on
// purpose: the site is a decorative demo of the report, not the scored
// analysis itself, so it does not depend on the extension package.
//
// The numbers it draws with are not duplicated, though. They come from
// data/reportVocabulary.json, generated from the extension's own
// definitions, so the band colours and the amplitude range cannot drift
// apart between the panel and the site.
import vocabulary from "../data/reportVocabulary.json";

export interface Band {
  slug: string;
  label: string;
  color: string;
}

export const BANDS: Band[] = vocabulary.bands;
export const BAND_LABELS: Record<string, string> = Object.fromEntries(
  vocabulary.bands.map((band) => [band.slug, band.label]),
);
export const BAND_COLORS: Record<string, string> = Object.fromEntries(
  vocabulary.bands.map((band) => [band.slug, band.color]),
);
export const ROSETTE = vocabulary.rosette;

// the fallback ink when a report carries a band this build does not know,
// which is a report from a newer extension than the site was built against.
export const UNKNOWN_BAND_COLOR = "#4C5C52";

export interface RosetteParams {
  harmonicA: number;
  harmonicB: number;
  amplitude: number;
  strokeColor: string;
}

export function rosettePath(params: RosetteParams, radius: number, samples = 240): string {
  const points: [number, number][] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const r =
      radius *
      (1 + (params.amplitude * (Math.cos(params.harmonicA * t) - Math.cos(params.harmonicB * t))) / 2);
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
