export const RELAY_CHANNEL = "verdict:bridge";
export const RELAYED_MESSAGE_TYPE = "verdict:bridge:relay";
export const RELAY_ATTRIBUTE = "data-verdict-relay";

const MAX_REQUEST_ID_LENGTH = 64;
// bounds what one page queues
export const MAX_IN_FLIGHT = 16;

export interface RelayRequestEnvelope {
  channel: typeof RELAY_CHANNEL;
  direction: "request";
  id: string;
  message: unknown;
}

export interface RelayResponseEnvelope {
  channel: typeof RELAY_CHANNEL;
  direction: "response";
  id: string;
  response: unknown;
}

export interface RelayedBridgeMessage {
  type: typeof RELAYED_MESSAGE_TYPE;
  message: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRelayRequestEnvelope(value: unknown): value is RelayRequestEnvelope {
  return (
    isRecord(value) &&
    value.channel === RELAY_CHANNEL &&
    value.direction === "request" &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= MAX_REQUEST_ID_LENGTH
  );
}

export function isRelayedBridgeMessage(value: unknown): value is RelayedBridgeMessage {
  return isRecord(value) && value.type === RELAYED_MESSAGE_TYPE && "message" in value;
}

export interface RelayTarget {
  location: { origin: string };
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
}

export type SendToBackground = (message: RelayedBridgeMessage) => Promise<unknown>;

// firefox lacks externally_connectable, hence this
export function installRelay(target: RelayTarget, send: SendToBackground): () => void {
  let inFlight = 0;

  const reply = (id: string, response: unknown) => {
    const envelope: RelayResponseEnvelope = { channel: RELAY_CHANNEL, direction: "response", id, response };
    target.postMessage(envelope, target.location.origin);
  };

  const listener = (event: MessageEvent) => {
    // same origin only, never embedded frames
    if (event.origin !== target.location.origin || !isRelayRequestEnvelope(event.data)) {
      return;
    }
    const { id, message } = event.data;
    if (inFlight >= MAX_IN_FLIGHT) {
      reply(id, { error: "busy" });
      return;
    }
    inFlight += 1;
    send({ type: RELAYED_MESSAGE_TYPE, message })
      .then(
        (response) => response ?? { error: "no response" },
        () => ({ error: "extension unavailable" }),
      )
      .then((response) => {
        inFlight -= 1;
        reply(id, response);
      });
  };

  target.addEventListener("message", listener);
  return () => target.removeEventListener("message", listener);
}
