// a small, self contained copy of the same guilloche curve the extension
// panel draws (extension/src/ui/rosette.ts), kept separate on purpose: the
// site is a decorative demo of the report, not the scored analysis itself,
// so it does not need to share code with, or depend on, the extension
// package.

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
