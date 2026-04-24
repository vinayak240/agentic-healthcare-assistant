import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { normalizeError } from '../errors/app-error';
import { LoggerService } from '../../logger/logger.service';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService = new LoggerService()) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const appError = normalizeError(exception, {
      requestPath: request?.url,
    });

    this.logger.error('http.exception.caught', {
      stage: appError.stage,
      operation: 'http_exception',
      status: 'failed',
      requestPath: request?.url,
      method: request?.method,
      statusCode: appError.statusCode,
      errorCode: appError.code,
    });

    response.status(appError.statusCode).json({
      error: appError,
    });
  }
}
