export abstract class BaseProducer {
  abstract produce(eventName: string, payload: unknown): void;
}
