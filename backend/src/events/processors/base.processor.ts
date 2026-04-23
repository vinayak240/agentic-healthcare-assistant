export abstract class BaseProcessor {
  abstract process(payload: unknown): unknown;
}
