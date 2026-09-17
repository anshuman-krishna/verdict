import { isMessageId, type MessageId } from "../i18n/messages";
import { ENGLISH_TRANSLATOR, type Translator } from "../i18n/translator";
import { SIGNAL_NAMES } from "./combine";
import { renderEvidenceMessages } from "./evidence";
import type { Band, EvidenceRow, EvidenceStrength } from "./report";

const BAND_MESSAGES: Record<Band, MessageId> = {
  clean: "band.clean",
  "mostly-clean": "band.mostly-clean",
  mixed: "band.mixed",
  doubtful: "band.doubtful",
  "heavily-manipulated": "band.heavily-manipulated",
};

const STRENGTH_MESSAGES: Record<EvidenceStrength, MessageId> = {
  none: "strength.none",
  weak: "strength.weak",
  moderate: "strength.moderate",
  strong: "strength.strong",
};

// a report carries the english name of the signal, including reports stored by builds
// older than this one, so the way back to a translatable id is through that name
function signalMessages(): Record<string, MessageId> {
  const built: Record<string, MessageId> = {};
  for (const [feature, name] of Object.entries(SIGNAL_NAMES)) {
    const id = `signal.${feature}`;
    if (isMessageId(id)) {
      built[name] = id;
    }
  }
  return built;
}

const SIGNAL_MESSAGES = signalMessages();

export function bandLabel(band: Band, translator: Translator = ENGLISH_TRANSLATOR): string {
  return translator.text(BAND_MESSAGES[band]);
}

export function strengthLabel(
  strength: EvidenceStrength,
  translator: Translator = ENGLISH_TRANSLATOR,
): string {
  return translator.text(STRENGTH_MESSAGES[strength]);
}

// a name from a newer build has no line here, and reads better than a blank
export function signalLabel(name: string, translator: Translator = ENGLISH_TRANSLATOR): string {
  const id = SIGNAL_MESSAGES[name];
  return id === undefined ? name : translator.text(id);
}

export function signalLabels(
  names: readonly string[],
  translator: Translator = ENGLISH_TRANSLATOR,
): string[] {
  return names.map((name) => signalLabel(name, translator));
}

// the stored english stands when a row predates structured messages
export function evidenceDetail(
  row: EvidenceRow,
  translator: Translator = ENGLISH_TRANSLATOR,
): string {
  return row.messages === undefined
    ? row.detail
    : renderEvidenceMessages(row.messages, translator);
}
