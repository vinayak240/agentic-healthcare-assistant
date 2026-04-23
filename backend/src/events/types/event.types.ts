export type EventPayload = Record<string, unknown>;

export type EventHandler = (payload: EventPayload) => void;
