import { afterEach, describe, expect, it } from 'bun:test';
import { LoggerService } from '../src/logger/logger.service';

describe('LoggerService', () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalConsole = {
    debug: console.debug,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }

    console.debug = originalConsole.debug;
    console.error = originalConsole.error;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
  });

  it('defaults to info and suppresses debug logs', () => {
    delete process.env.LOG_LEVEL;
    const calls = captureConsoleCalls();
    const logger = new LoggerService();

    logger.debug('debug.event');
    logger.info('info.event');

    expect(calls.debug).toHaveLength(0);
    expect(calls.log).toHaveLength(1);
    expect(calls.log[0]).toContain('"event":"info.event"');
  });

  it('allows debug logs when LOG_LEVEL is debug', () => {
    process.env.LOG_LEVEL = 'debug';
    const calls = captureConsoleCalls();
    const logger = new LoggerService();

    logger.debug('debug.event');

    expect(calls.debug).toHaveLength(1);
    expect(calls.debug[0]).toContain('"event":"debug.event"');
  });

  it('uses warn threshold when LOG_LEVEL is warn', () => {
    process.env.LOG_LEVEL = 'warn';
    const calls = captureConsoleCalls();
    const logger = new LoggerService();

    logger.info('info.event');
    logger.warn('warn.event');
    logger.error('error.event');

    expect(calls.log).toHaveLength(0);
    expect(calls.warn).toHaveLength(1);
    expect(calls.error).toHaveLength(1);
  });

  it('falls back to info when LOG_LEVEL is invalid', () => {
    process.env.LOG_LEVEL = 'verbose';
    const calls = captureConsoleCalls();
    const logger = new LoggerService();

    logger.debug('debug.event');
    logger.info('info.event');

    expect(calls.debug).toHaveLength(0);
    expect(calls.log).toHaveLength(1);
  });
});

function captureConsoleCalls() {
  const calls = {
    debug: [] as string[],
    error: [] as string[],
    log: [] as string[],
    warn: [] as string[],
  };

  console.debug = (...args: unknown[]) => {
    calls.debug.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    calls.error.push(args.map(String).join(' '));
  };
  console.log = (...args: unknown[]) => {
    calls.log.push(args.map(String).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    calls.warn.push(args.map(String).join(' '));
  };

  return calls;
}
