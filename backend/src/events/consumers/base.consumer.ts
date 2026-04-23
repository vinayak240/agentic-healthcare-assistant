export abstract class BaseConsumer {
  abstract consume(eventName: string, payload: unknown): void;
}
