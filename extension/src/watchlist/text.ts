import { ENGLISH_TRANSLATOR, type Translator } from "../i18n/translator";
import type { Band } from "../score/report";
import { bandLabel } from "../score/reportText";
import type { WatchChange } from "./drift";

function percent(value: string | number): number {
  return Math.round(Number(value) * 100);
}

export function changeLine(change: WatchChange, t: Translator = ENGLISH_TRANSLATOR): string {
  switch (change.kind) {
    case "band":
      return t.text("watch.change.band", {
        from: bandLabel(change.from as Band, t),
        to: bandLabel(change.to as Band, t),
      });
    case "rating":
      return t.text("watch.change.rating", {
        from: t.decimal(Number(change.from), 1),
        to: t.decimal(Number(change.to), 1),
      });
    case "reviews":
      return t.text("watch.change.reviews", {
        from: t.number(Number(change.from)),
        to: t.number(Number(change.to)),
      });
    case "burst":
      return t.text("watch.change.burst", {
        from: percent(change.from),
        to: percent(change.to),
      });
    case "drift":
      return t.text("watch.change.drift");
  }
}

export function changeLines(
  changes: readonly WatchChange[],
  t: Translator = ENGLISH_TRANSLATOR,
): string[] {
  return changes.map((change) => changeLine(change, t));
}
