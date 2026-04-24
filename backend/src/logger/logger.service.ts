import { Injectable } from '@nestjs/common';

export interface LogContext {
  [key: string]: unknown;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

@Injectable()
export class LoggerService {
  private defaults: LogContext = {};

  child(defaults: LogContext): LoggerService {
    const child = new LoggerService();
    child.defaults = {
      ...this.defaults,
      ...defaults,
    };

    return child;
  }

  log(event: string, metadata: LogContext = {}): void {
    this.write('info', event, metadata);
  }

  info(event: string, metadata: LogContext = {}): void {
    this.write('info', event, metadata);
  }

  debug(event: string, metadata: LogContext = {}): void {
    this.write('debug', event, metadata);
  }

  warn(event: string, metadata: LogContext = {}): void {
    this.write('warn', event, metadata);
  }

  error(event: string, metadata: LogContext = {}): void {
    this.write('error', event, metadata);
  }

  private write(level: LogLevel, event: string, metadata: LogContext): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...this.defaults,
      ...metadata,
    };
    const serialized = JSON.stringify(entry);

    if (level === 'error') {
      console.error(serialized);
      return;
    }

    if (level === 'warn') {
      console.warn(serialized);
      return;
    }

    if (level === 'debug') {
      console.debug(serialized);
      return;
    }

    console.log(serialized);
  }
}
