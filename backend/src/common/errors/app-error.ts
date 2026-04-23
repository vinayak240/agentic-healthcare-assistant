import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import OpenAI from 'openai';

export type AppErrorStage =
  | 'request'
  | 'preflight'
  | 'reasoning'
  | 'rendering'
  | 'tool'
  | 'system';

export type AppErrorDetails = Record<string, unknown>;

export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'RESOURCE_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'USER_ALREADY_EXISTS'
  | 'CHAT_REQUEST_INVALID'
  | 'USER_NOT_FOUND'
  | 'CONVERSATION_NOT_FOUND'
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_RATE_LIMITED'
  | 'LLM_TIMEOUT'
  | 'LLM_UNAVAILABLE'
  | 'LLM_BAD_RESPONSE'
  | 'LLM_RENDERING_FAILED'
  | 'TOOL_EXECUTION_FAILED'
  | 'CHAT_INTERNAL_ERROR';

export interface AppError {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  stage: AppErrorStage;
  statusCode: number;
  details?: AppErrorDetails;
}

type AppErrorDefinition = Omit<AppError, 'details'>;

const APP_ERROR_DEFINITIONS: Record<AppErrorCode, AppErrorDefinition> = {
  BAD_REQUEST: {
    code: 'BAD_REQUEST',
    message: 'Please review the request and try again.',
    retryable: false,
    stage: 'request',
    statusCode: HttpStatus.BAD_REQUEST,
  },
  RESOURCE_NOT_FOUND: {
    code: 'RESOURCE_NOT_FOUND',
    message: 'We could not find the requested resource.',
    retryable: false,
    stage: 'request',
    statusCode: HttpStatus.NOT_FOUND,
  },
  RUN_NOT_FOUND: {
    code: 'RUN_NOT_FOUND',
    message: 'We could not find that run.',
    retryable: false,
    stage: 'request',
    statusCode: HttpStatus.NOT_FOUND,
  },
  USER_ALREADY_EXISTS: {
    code: 'USER_ALREADY_EXISTS',
    message: 'A user with that email already exists.',
    retryable: false,
    stage: 'request',
    statusCode: HttpStatus.CONFLICT,
  },
  CHAT_REQUEST_INVALID: {
    code: 'CHAT_REQUEST_INVALID',
    message: 'Please review the chat request and try again.',
    retryable: false,
    stage: 'request',
    statusCode: HttpStatus.BAD_REQUEST,
  },
  USER_NOT_FOUND: {
    code: 'USER_NOT_FOUND',
    message: 'We could not find that user.',
    retryable: false,
    stage: 'preflight',
    statusCode: HttpStatus.NOT_FOUND,
  },
  CONVERSATION_NOT_FOUND: {
    code: 'CONVERSATION_NOT_FOUND',
    message: 'We could not find that conversation.',
    retryable: false,
    stage: 'preflight',
    statusCode: HttpStatus.NOT_FOUND,
  },
  LLM_NOT_CONFIGURED: {
    code: 'LLM_NOT_CONFIGURED',
    message: 'The assistant is not configured right now. Please try again later.',
    retryable: false,
    stage: 'preflight',
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  LLM_RATE_LIMITED: {
    code: 'LLM_RATE_LIMITED',
    message: 'The assistant is busy right now. Please try again in a moment.',
    retryable: true,
    stage: 'reasoning',
    statusCode: HttpStatus.TOO_MANY_REQUESTS,
  },
  LLM_TIMEOUT: {
    code: 'LLM_TIMEOUT',
    message: 'The assistant took too long to respond. Please try again.',
    retryable: true,
    stage: 'reasoning',
    statusCode: HttpStatus.GATEWAY_TIMEOUT,
  },
  LLM_UNAVAILABLE: {
    code: 'LLM_UNAVAILABLE',
    message: 'The assistant is temporarily unavailable. Please try again soon.',
    retryable: true,
    stage: 'reasoning',
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
  },
  LLM_BAD_RESPONSE: {
    code: 'LLM_BAD_RESPONSE',
    message: 'The assistant returned an invalid response. Please try again.',
    retryable: true,
    stage: 'reasoning',
    statusCode: HttpStatus.BAD_GATEWAY,
  },
  LLM_RENDERING_FAILED: {
    code: 'LLM_RENDERING_FAILED',
    message: 'The answer was delivered with a fallback response.',
    retryable: true,
    stage: 'rendering',
    statusCode: HttpStatus.OK,
  },
  TOOL_EXECUTION_FAILED: {
    code: 'TOOL_EXECUTION_FAILED',
    message: 'One of the assistant tools failed, so the answer may use limited data.',
    retryable: false,
    stage: 'tool',
    statusCode: HttpStatus.OK,
  },
  CHAT_INTERNAL_ERROR: {
    code: 'CHAT_INTERNAL_ERROR',
    message: 'Something went wrong while completing the chat. Please try again.',
    retryable: true,
    stage: 'system',
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  },
};

export class AppException extends HttpException {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super({ error: appError }, appError.statusCode);
    this.appError = appError;
  }
}

export function createAppError(
  code: AppErrorCode,
  overrides: Partial<Omit<AppError, 'code'>> = {},
): AppError {
  return {
    ...APP_ERROR_DEFINITIONS[code],
    ...overrides,
    code,
  };
}

export function createAppException(
  code: AppErrorCode,
  overrides: Partial<Omit<AppError, 'code'>> = {},
): AppException {
  return new AppException(createAppError(code, overrides));
}

export function isAppError(value: unknown): value is AppError {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean' &&
    typeof candidate.stage === 'string' &&
    typeof candidate.statusCode === 'number'
  );
}

export function normalizeError(
  error: unknown,
  options: {
    stage?: AppErrorStage;
    requestPath?: string;
    fallbackCode?: AppErrorCode;
  } = {},
): AppError {
  if (error instanceof AppException) {
    return error.appError;
  }

  if (isAppError(error)) {
    return error;
  }

  if (error instanceof HttpException) {
    return mapHttpException(error, options.requestPath);
  }

  return mapUnknownError(error, options);
}

export function buildRenderingWarning(error: unknown): AppError {
  const cause = normalizeError(error, {
    stage: 'rendering',
    fallbackCode: 'LLM_UNAVAILABLE',
  });

  return createAppError('LLM_RENDERING_FAILED', {
    retryable: cause.retryable,
    details: {
      causeCode: cause.code,
      causeStatusCode: cause.statusCode,
    },
  });
}

export function buildToolError(
  error: unknown,
  details: Record<string, unknown> = {},
): AppError {
  return createAppError('TOOL_EXECUTION_FAILED', {
    details: {
      ...details,
      reason: error instanceof Error ? error.name : 'unknown_tool_error',
    },
  });
}

export function toEventErrorPayload(appError: AppError): {
  error: string;
  errorCode: AppErrorCode;
  errorStage: AppErrorStage;
  errorRetryable: boolean;
  errorStatusCode: number;
  errorDetails?: AppErrorDetails;
} {
  return {
    error: appError.message,
    errorCode: appError.code,
    errorStage: appError.stage,
    errorRetryable: appError.retryable,
    errorStatusCode: appError.statusCode,
    ...(appError.details ? { errorDetails: appError.details } : {}),
  };
}

function mapHttpException(error: HttpException, requestPath?: string): AppError {
  const response = error.getResponse();

  if (error instanceof NotFoundException) {
    const message = extractHttpMessage(response);

    if (message === 'User not found') {
      return createAppError('USER_NOT_FOUND');
    }

    if (message === 'Conversation not found') {
      return createAppError('CONVERSATION_NOT_FOUND');
    }

    if (message === 'Run not found') {
      return createAppError('RUN_NOT_FOUND');
    }

    return createAppError('RESOURCE_NOT_FOUND');
  }

  if (error instanceof ConflictException) {
    return createAppError('USER_ALREADY_EXISTS');
  }

  if (error instanceof BadRequestException) {
    const details = extractHttpDetails(response);

    return createAppError(
      requestPath?.startsWith('/chat') ? 'CHAT_REQUEST_INVALID' : 'BAD_REQUEST',
      details ? { details } : {},
    );
  }

  const statusCode = error.getStatus();

  return createAppError('CHAT_INTERNAL_ERROR', {
    statusCode:
      typeof statusCode === 'number' && statusCode > 0
        ? statusCode
        : HttpStatus.INTERNAL_SERVER_ERROR,
  });
}

function mapUnknownError(
  error: unknown,
  options: {
    stage?: AppErrorStage;
    fallbackCode?: AppErrorCode;
  },
): AppError {
  if (!error || typeof error !== 'object') {
    return createAppError(options.fallbackCode ?? 'CHAT_INTERNAL_ERROR', {
      ...(options.stage ? { stage: options.stage } : {}),
    });
  }

  if (error instanceof OpenAI.RateLimitError) {
    return createAppError('LLM_RATE_LIMITED', {
      stage: options.stage ?? 'reasoning',
      details: {
        provider: 'openai',
        providerStatusCode: error.status,
      },
    });
  }

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return createAppError('LLM_TIMEOUT', {
      stage: options.stage ?? 'reasoning',
      details: {
        provider: 'openai',
      },
    });
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return createAppError('LLM_UNAVAILABLE', {
      stage: options.stage ?? 'reasoning',
      details: {
        provider: 'openai',
      },
    });
  }

  if (
    error instanceof OpenAI.BadRequestError ||
    error instanceof OpenAI.UnprocessableEntityError
  ) {
    return createAppError('LLM_BAD_RESPONSE', {
      stage: options.stage ?? 'reasoning',
      details: {
        provider: 'openai',
        providerStatusCode: error.status,
      },
    });
  }

  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError ||
    error instanceof OpenAI.NotFoundError ||
    error instanceof OpenAI.InternalServerError ||
    error instanceof OpenAI.APIError
  ) {
    return createAppError('LLM_UNAVAILABLE', {
      stage: options.stage ?? 'reasoning',
      details: {
        provider: 'openai',
        providerStatusCode: 'status' in error ? error.status : undefined,
      },
    });
  }

  if (error instanceof Error) {
    return createAppError(options.fallbackCode ?? 'CHAT_INTERNAL_ERROR', {
      ...(options.stage ? { stage: options.stage } : {}),
      details: {
        reason: error.name,
      },
    });
  }

  return createAppError(options.fallbackCode ?? 'CHAT_INTERNAL_ERROR', {
    ...(options.stage ? { stage: options.stage } : {}),
  });
}

function extractHttpMessage(response: string | object): string | null {
  if (typeof response === 'string') {
    return response;
  }

  if (!response || typeof response !== 'object') {
    return null;
  }

  const candidate = response as Record<string, unknown>;

  return typeof candidate.message === 'string' ? candidate.message : null;
}

function extractHttpDetails(response: string | object): AppErrorDetails | undefined {
  if (!response || typeof response !== 'object') {
    return undefined;
  }

  const candidate = response as Record<string, unknown>;

  if (Array.isArray(candidate.message)) {
    return {
      issues: candidate.message.filter((value): value is string => typeof value === 'string'),
    };
  }

  if (typeof candidate.message === 'string') {
    return {
      issues: [candidate.message],
    };
  }

  return undefined;
}
