import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { normalizeError } from '../errors/app-error';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const appError = normalizeError(exception, {
      requestPath: request?.url,
    });

    response.status(appError.statusCode).json({
      error: appError,
    });
  }
}
