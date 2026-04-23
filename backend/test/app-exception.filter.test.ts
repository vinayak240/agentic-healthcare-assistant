import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'bun:test';
import type { ArgumentsHost } from '@nestjs/common';
import { AppExceptionFilter } from '../src/common/filters/app-exception.filter';

describe('AppExceptionFilter', () => {
  it('formats chat validation errors as CHAT_REQUEST_INVALID', () => {
    const filter = new AppExceptionFilter();
    const response = createMockResponse();

    filter.catch(
      new BadRequestException({
        message: ['message should not be empty'],
      }),
      createHost('/chat', response),
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: expect.objectContaining({
        code: 'CHAT_REQUEST_INVALID',
        statusCode: 400,
        details: {
          issues: ['message should not be empty'],
        },
      }),
    });
  });

  it('formats not-found errors with stable resource codes', () => {
    const filter = new AppExceptionFilter();
    const response = createMockResponse();

    filter.catch(new NotFoundException('Conversation not found'), createHost('/chat', response));

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: expect.objectContaining({
        code: 'CONVERSATION_NOT_FOUND',
        statusCode: 404,
      }),
    });
  });
});

function createHost(url: string, response: ReturnType<typeof createMockResponse>): ArgumentsHost {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return {
            url,
          };
        },
        getResponse() {
          return response;
        },
      };
    },
  } as ArgumentsHost;
}

function createMockResponse() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}
