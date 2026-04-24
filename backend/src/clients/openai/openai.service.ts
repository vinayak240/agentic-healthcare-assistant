import { Injectable, Optional } from '@nestjs/common';
import OpenAI from 'openai';
import {
  createAppException,
  normalizeError,
} from '../../common/errors/app-error';
import { ConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';

interface JsonCompletionResult {
  content: string;
  totalTokens: number;
}

interface SpeechInput {
  text: string;
  model?: string;
  voice?: string;
}

@Injectable()
export class OpenAiService {
  private client: OpenAI | null = null;
  private readonly logger: LoggerService;

  constructor(
    private readonly configService: ConfigService,
    @Optional() logger: LoggerService = new LoggerService(),
  ) {
    this.logger = logger.child({
      component: OpenAiService.name,
    });
  }

  assertConfigured(): void {
    this.getClientOrThrow();
  }

  async createJsonResponse(prompt: string): Promise<JsonCompletionResult> {
    const client = this.getClientOrThrow();
    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';
    const startedAt = Date.now();

    this.logger.debug('openai.request.started', {
      stage: 'reasoning',
      operation: 'responses_create',
      status: 'started',
      requestType: 'json',
      model,
      promptLength: prompt.length,
    });

    try {
      const response = await client.responses.create({
        model,
        input: prompt,
      });
      const rawResponse = response as unknown as {
        output_text?: string;
        usage?: {
          total_tokens?: number;
        };
      };
      const content = rawResponse.output_text?.trim();

      if (!content) {
        throw createAppException('LLM_BAD_RESPONSE');
      }

      this.logger.debug('openai.request.completed', {
        stage: 'reasoning',
        operation: 'responses_create',
        status: 'completed',
        requestType: 'json',
        model,
        durationMs: Date.now() - startedAt,
        totalTokens: rawResponse.usage?.total_tokens ?? 0,
      });

      return {
        content,
        totalTokens: rawResponse.usage?.total_tokens ?? 0,
      };
    } catch (error) {
      const appError = normalizeError(error, {
        stage: 'reasoning',
        fallbackCode: 'LLM_UNAVAILABLE',
      });

      this.logger.error('openai.request.failed', {
        stage: 'reasoning',
        operation: 'responses_create',
        status: 'failed',
        requestType: 'json',
        model,
        durationMs: Date.now() - startedAt,
        errorCode: appError.code,
      });

      throw appError;
    }
  }

  async *streamTextResponse(prompt: string): AsyncGenerator<string, JsonCompletionResult> {
    const client = this.getClientOrThrow();
    const model = this.configService.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';
    const startedAt = Date.now();

    this.logger.debug('openai.request.started', {
      stage: 'rendering',
      operation: 'responses_create',
      status: 'started',
      requestType: 'stream',
      model,
      promptLength: prompt.length,
    });

    try {
      const stream = await client.responses.create({
        model,
        input: prompt,
        stream: true,
      });
      let content = '';
      let totalTokens = 0;

      for await (const event of stream) {
        const typedEvent = event as {
          type?: string;
          delta?: string;
          response?: {
            usage?: {
              total_tokens?: number;
            };
          };
        };

        if (typedEvent.type === 'response.output_text.delta' && typedEvent.delta) {
          content += typedEvent.delta;
          yield typedEvent.delta;
        }

        if (typedEvent.type === 'response.completed') {
          totalTokens = typedEvent.response?.usage?.total_tokens ?? totalTokens;
        }
      }

      const finalContent = content.trim();

      if (!finalContent) {
        throw createAppException('LLM_BAD_RESPONSE');
      }

      this.logger.debug('openai.request.completed', {
        stage: 'rendering',
        operation: 'responses_create',
        status: 'completed',
        requestType: 'stream',
        model,
        durationMs: Date.now() - startedAt,
        totalTokens,
      });

      return {
        content: finalContent,
        totalTokens,
      };
    } catch (error) {
      const appError = normalizeError(error, {
        stage: 'rendering',
        fallbackCode: 'LLM_UNAVAILABLE',
      });

      this.logger.error('openai.request.failed', {
        stage: 'rendering',
        operation: 'responses_create',
        status: 'failed',
        requestType: 'stream',
        model,
        durationMs: Date.now() - startedAt,
        errorCode: appError.code,
      });

      throw appError;
    }
  }

  async createSpeech(input: SpeechInput): Promise<Buffer> {
    const client = this.getClientOrThrow();
    const model = input.model ?? 'gpt-4o-mini-tts';
    const voice = input.voice ?? 'coral';
    const startedAt = Date.now();

    this.logger.debug('openai.request.started', {
      stage: 'audio',
      operation: 'audio_speech_create',
      status: 'started',
      requestType: 'speech',
      model,
      voice,
      inputLength: input.text.length,
    });

    try {
      const response = await client.audio.speech.create({
        model,
        voice: voice as never,
        input: input.text,
        response_format: 'mp3',
      });
      const arrayBuffer = await response.arrayBuffer();
      const audio = Buffer.from(arrayBuffer);

      this.logger.debug('openai.request.completed', {
        stage: 'audio',
        operation: 'audio_speech_create',
        status: 'completed',
        requestType: 'speech',
        model,
        voice,
        durationMs: Date.now() - startedAt,
        byteLength: audio.byteLength,
      });

      return audio;
    } catch (error) {
      const appError = normalizeError(error, {
        stage: 'rendering',
        fallbackCode: 'LLM_UNAVAILABLE',
      });

      this.logger.error('openai.request.failed', {
        stage: 'audio',
        operation: 'audio_speech_create',
        status: 'failed',
        requestType: 'speech',
        model,
        voice,
        durationMs: Date.now() - startedAt,
        errorCode: appError.code,
      });

      throw appError;
    }
  }

  private getClientOrThrow(): OpenAI {
    const apiKey = this.configService.get('OPENAI_KEY');

    if (!apiKey) {
      throw createAppException('LLM_NOT_CONFIGURED');
    }

    if (!this.client) {
      this.client = new OpenAI({ apiKey });
    }

    return this.client;
  }
}
