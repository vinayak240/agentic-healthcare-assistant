import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Types } from 'mongoose';
import { OpenAiService } from '../../clients/openai/openai.service';
import { MinioStorageService } from '../../clients/storage/minio-storage.service';
import { ConversationsRepository } from '../../dal/repositories/conversations.repository';
import { EventsRepository } from '../../dal/repositories/events.repository';
import type { MessageCursorInput } from '../../dal/repositories/messages.repository';
import { MessagesRepository } from '../../dal/repositories/messages.repository';
import { RunsRepository } from '../../dal/repositories/runs.repository';
import { UsagesRepository } from '../../dal/repositories/usages.repository';
import type { MessageAudioMetadata } from '../../dal/interfaces/dal.types';
import type { Conversation } from '../../dal/schemas/conversation.schema';
import type { Event } from '../../dal/schemas/event.schema';
import type { Message } from '../../dal/schemas/message.schema';
import { LoggerService } from '../../logger/logger.service';
import type { HydratedDocument } from 'mongoose';

const AUDIO_CONTENT_TYPE = 'audio/mpeg';
const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_TTS_VOICE = 'coral';
const TTS_CHUNK_MAX_WORDS = 15;
const TTS_CHUNK_BATCH_SIZE = 15;

@Injectable()
export class ConversationService {
  constructor(
    private readonly conversationsRepository: ConversationsRepository,
    private readonly messagesRepository: MessagesRepository,
    private readonly eventsRepository: EventsRepository,
    private readonly usagesRepository: UsagesRepository,
    private readonly runsRepository: RunsRepository,
    private readonly openAiService: OpenAiService,
    private readonly storageService: MinioStorageService,
    @Optional() private readonly logger: LoggerService = new LoggerService(),
  ) {}

  async listConversations(params: { userId: string; limit?: number; cursor?: string }) {
    const limit = params.limit ?? 20;
    const cursor = params.cursor ? this.decodeConversationCursor(params.cursor) : undefined;
    const conversations = await this.conversationsRepository.findPageByUserId({
      userId: params.userId,
      limit: limit + 1,
      cursor,
    });
    const page = conversations.slice(0, limit);
    const nextCursor =
      conversations.length > limit ? this.encodeConversationCursor(page[page.length - 1]) : null;

    return {
      items: page.map((conversation) => this.serializeConversation(conversation)),
      nextCursor,
    };
  }

  async getConversation(id: string) {
    const conversation = await this.conversationsRepository.findById(id);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.serializeConversation(conversation);
  }

  async listMessages(params: { conversationId: string; limit?: number; cursor?: string }) {
    const conversation = await this.conversationsRepository.findById(params.conversationId);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const limit = params.limit ?? 20;
    const cursor = params.cursor ? this.decodeMessageCursor(params.cursor) : undefined;
    const messages = await this.messagesRepository.findPageByConversationId({
      conversationId: params.conversationId,
      limit: limit + 1,
      cursor,
    });
    const page = messages.slice(0, limit);
    const nextCursor =
      messages.length > limit ? this.encodeMessageCursor(page[page.length - 1]) : null;

    return {
      conversationId: params.conversationId,
      items: await Promise.all(page.map((message) => this.serializeMessage(message))),
      nextCursor,
    };
  }

  async listToolEvents(params: { conversationId: string; runId?: string }) {
    const conversation = await this.conversationsRepository.findById(params.conversationId);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const events = await this.eventsRepository.findMany({
      conversationId: params.conversationId,
      ...(params.runId ? { runId: params.runId } : {}),
      type: {
        $in: ['tool_called', 'tool_result', 'reasoning_delta', 'usage_final'],
      },
    });

    const items = [...events]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((event) => this.serializeToolEvent(event));

    return {
      conversationId: params.conversationId,
      items,
    };
  }

  async createAppointmentFollowUp(params: {
    conversationId: string;
    runId: string;
    specialty?: string;
    reason?: string;
    doctorName?: string;
    phone?: string;
  }) {
    const conversation = await this.conversationsRepository.findById(params.conversationId);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const text = this.buildAppointmentFollowUpText(params);
    const createdAt = new Date();
    const message = await this.messagesRepository.create({
      userId: this.toObjectId(String(conversation.userId)),
      conversationId: this.toObjectId(params.conversationId),
      runId: this.toObjectId(params.runId),
      role: 'assistant',
      content: {
        text,
        metadata: {
          kind: 'appointment_follow_up_confirmation',
          handoffRunId: params.runId,
          toolName: 'book_appointment',
          specialty: params.specialty,
          reason: params.reason,
          doctorName: params.doctorName,
          phone: params.phone,
        },
      },
      cudFoil: {
        createdAt,
        updatedAt: createdAt,
        deleted: false,
        deletedAt: null,
      },
    });

    await this.conversationsRepository.updateById(params.conversationId, {
      $set: {
        lastMessageAt: createdAt,
      },
    });

    return this.serializeMessage(message);
  }

  async createMessageAudio(params: { conversationId: string; messageId: string }) {
    const conversation = await this.conversationsRepository.findById(params.conversationId);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const message = await this.messagesRepository.findById(params.messageId);

    if (!message || String(message.conversationId) !== params.conversationId) {
      throw new NotFoundException('Message not found');
    }

    if (message.role !== 'assistant') {
      throw new BadRequestException('Audio can only be generated for assistant messages');
    }

    const existingAudio = message.content.metadata?.audio;

    if (existingAudio?.status === 'ready') {
      return this.serializeMessageAudio(existingAudio);
    }

    const chunks = this.splitTextForSpeech(message.content.text);

    if (chunks.length === 0) {
      throw new BadRequestException('Message has no text to convert to audio');
    }

    try {
      // Sequential chunk generation adds too much latency, so create speech in parallel batches.
      // The batch size keeps long responses from making unbounded OpenAI and storage calls.
      const uploadedChunks = await this.createAndUploadSpeechChunks({
        chunks,
        conversationId: params.conversationId,
        messageId: params.messageId,
      });

      const audioMetadata: MessageAudioMetadata = {
        status: 'ready',
        provider: 'openai',
        model: DEFAULT_TTS_MODEL,
        voice: DEFAULT_TTS_VOICE,
        generatedAt: new Date().toISOString(),
        chunks: uploadedChunks,
      };

      await this.messagesRepository.updateById(params.messageId, {
        $set: {
          'content.metadata.audio': audioMetadata,
        },
      });

      this.logger.info('conversation.message_audio.created', {
        stage: 'audio',
        operation: 'create_message_audio',
        status: 'completed',
        conversationId: params.conversationId,
        messageId: params.messageId,
        chunkCount: uploadedChunks.length,
      });

      return this.serializeMessageAudio(audioMetadata);
    } catch (error) {
      this.logger.error('conversation.message_audio.failed', {
        stage: 'audio',
        operation: 'create_message_audio',
        status: 'failed',
        conversationId: params.conversationId,
        messageId: params.messageId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : 'Unknown audio generation error',
      });

      throw error;
    }
  }

  async deleteMessage(params: { conversationId: string; messageId: string }) {
    const conversation = await this.conversationsRepository.findById(params.conversationId);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const message = await this.messagesRepository.findById(params.messageId);

    if (!message || String(message.conversationId) !== params.conversationId) {
      throw new NotFoundException('Message not found');
    }

    const deleted = await this.messagesRepository.softDeleteById(params.messageId);

    if (!deleted) {
      throw new NotFoundException('Message not found');
    }

    const remainingMessages = await this.messagesRepository.findPageByConversationId({
      conversationId: params.conversationId,
      limit: 1,
    });
    const lastRemainingMessage = remainingMessages[0];

    await this.conversationsRepository.updateById(params.conversationId, {
      $set: {
        lastMessageAt: lastRemainingMessage?.cudFoil.createdAt ?? new Date(),
      },
    });

    return {
      id: params.messageId,
      conversationId: params.conversationId,
      deleted: true,
    };
  }

  async deleteConversation(params: { conversationId: string }) {
    const conversation = await this.conversationsRepository.findById(params.conversationId);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.messagesRepository.softDeleteByConversationId(params.conversationId);
    await this.runsRepository.softDeleteByConversationId(params.conversationId);

    const deleted = await this.conversationsRepository.softDeleteById(params.conversationId);

    if (!deleted) {
      throw new NotFoundException('Conversation not found');
    }

    return {
      id: params.conversationId,
      deleted: true,
    };
  }

  private serializeConversation(conversation: HydratedDocument<Conversation>) {
    return {
      id: conversation._id.toString(),
      userId: String(conversation.userId),
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      createdAt: conversation.cudFoil.createdAt?.toISOString() ?? null,
      updatedAt: conversation.cudFoil.updatedAt?.toISOString() ?? null,
    };
  }

  private async serializeMessage(message: HydratedDocument<Message>) {
    const usage = message.role === 'assistant'
      ? await this.usagesRepository.findByRunId(String(message.runId))
      : null;

    const metadata = {
      ...(message.content.metadata ?? {}),
      ...(message.role === 'assistant'
        ? {
            modelName:
              message.content.metadata?.modelName ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
          }
        : {}),
      ...(usage ? { totalTokens: usage.totalTokens } : {}),
    };

    if (metadata.audio?.status === 'ready') {
      metadata.audio = await this.serializeMessageAudioForHistory(metadata.audio);
    }

    return {
      id: message._id.toString(),
      userId: String(message.userId),
      conversationId: String(message.conversationId),
      runId: String(message.runId),
      role: message.role,
      text: message.content.text,
      metadata,
      createdAt: message.cudFoil.createdAt?.toISOString() ?? null,
      updatedAt: message.cudFoil.updatedAt?.toISOString() ?? null,
    };
  }

  private async serializeMessageAudio(audio: MessageAudioMetadata) {
    return {
      status: audio.status,
      provider: audio.provider,
      model: audio.model,
      voice: audio.voice,
      generatedAt: audio.generatedAt,
      chunks: await Promise.all(
        audio.chunks
          .slice()
          .sort((left, right) => left.index - right.index)
          .map(async (chunk) => ({
            index: chunk.index,
            objectKey: chunk.objectKey,
            contentType: chunk.contentType,
            url: await this.storageService.createPresignedReadUrl(chunk.objectKey),
          })),
      ),
    };
  }

  private async serializeMessageAudioForHistory(audio: MessageAudioMetadata) {
    try {
      return await this.serializeMessageAudio(audio);
    } catch (error) {
      this.logger.warn('conversation.message_audio.presign_failed', {
        stage: 'audio',
        operation: 'serialize_message_audio',
        status: 'warning',
        error: error instanceof Error ? error.message : 'Unknown audio signing error',
      });

      return audio;
    }
  }

  private async createAndUploadSpeechChunks(input: {
    chunks: string[];
    conversationId: string;
    messageId: string;
  }): Promise<MessageAudioMetadata['chunks']> {
    const uploadedChunks: MessageAudioMetadata['chunks'] = [];

    for (let start = 0; start < input.chunks.length; start += TTS_CHUNK_BATCH_SIZE) {
      const batch = input.chunks.slice(start, start + TTS_CHUNK_BATCH_SIZE);
      const batchUploads = await Promise.all(
        batch.map((text, offset) =>
          this.createAndUploadSpeechChunk({
            text,
            index: start + offset,
            conversationId: input.conversationId,
            messageId: input.messageId,
          }),
        ),
      );

      uploadedChunks.push(...batchUploads);
    }

    return uploadedChunks;
  }

  private async createAndUploadSpeechChunk(input: {
    text: string;
    index: number;
    conversationId: string;
    messageId: string;
  }): Promise<MessageAudioMetadata['chunks'][number]> {
    const audio = await this.openAiService.createSpeech({
      text: input.text,
      model: DEFAULT_TTS_MODEL,
      voice: DEFAULT_TTS_VOICE,
    });
    const objectKey = [
      'conversations',
      input.conversationId,
      'messages',
      input.messageId,
      `chunk-${String(input.index).padStart(3, '0')}.mp3`,
    ].join('/');

    await this.storageService.uploadObject({
      key: objectKey,
      body: audio,
      contentType: AUDIO_CONTENT_TYPE,
    });

    return {
      index: input.index,
      objectKey,
      contentType: AUDIO_CONTENT_TYPE,
    };
  }

  private splitTextForSpeech(text: string): string[] {
    const normalized = text.replace(/\s+/g, ' ').trim();

    if (!normalized) {
      return [];
    }

    const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized];
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences.map((value) => value.trim()).filter(Boolean)) {
      if (!current) {
        current = sentence;
        continue;
      }

      if (this.countWords(`${current} ${sentence}`) <= TTS_CHUNK_MAX_WORDS) {
        current = `${current} ${sentence}`;
        continue;
      }

      chunks.push(current);
      current = sentence;
    }

    if (current) {
      chunks.push(current);
    }

    return chunks.flatMap((chunk) => this.splitOversizedSpeechChunk(chunk));
  }

  private splitOversizedSpeechChunk(chunk: string): string[] {
    const words = chunk.split(' ').filter(Boolean);

    if (words.length <= TTS_CHUNK_MAX_WORDS) {
      return [chunk];
    }

    const parts: string[] = [];

    for (let start = 0; start < words.length; start += TTS_CHUNK_MAX_WORDS) {
      parts.push(words.slice(start, start + TTS_CHUNK_MAX_WORDS).join(' '));
    }

    return parts.filter(Boolean);
  }

  private countWords(value: string): number {
    return value.split(' ').filter(Boolean).length;
  }

  private serializeToolEvent(event: HydratedDocument<Event>) {
    return {
      id: event._id.toString(),
      conversationId: String(event.conversationId),
      runId: String(event.runId),
      type: event.type,
      createdAt: event.createdAt.toISOString(),
      payload: event.payload,
    };
  }

  private encodeConversationCursor(conversation: HydratedDocument<Conversation>): string {
    return Buffer.from(
      JSON.stringify({
        id: conversation._id.toString(),
        lastMessageAt: conversation.lastMessageAt.toISOString(),
      }),
      'utf8',
    ).toString('base64url');
  }

  private decodeConversationCursor(cursor: string): { id: string; lastMessageAt: Date } {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        id: string;
        lastMessageAt: string;
      };

      return {
        id: decoded.id,
        lastMessageAt: new Date(decoded.lastMessageAt),
      };
    } catch {
      throw new BadRequestException('Invalid conversation cursor');
    }
  }

  private encodeMessageCursor(message: HydratedDocument<Message>): string {
    return Buffer.from(
      JSON.stringify({
        id: message._id.toString(),
        createdAt: message.cudFoil.createdAt?.toISOString() ?? new Date(0).toISOString(),
      }),
      'utf8',
    ).toString('base64url');
  }

  private decodeMessageCursor(cursor: string): MessageCursorInput {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        id: string;
        createdAt: string;
      };

      return {
        id: decoded.id,
        createdAt: new Date(decoded.createdAt),
      };
    } catch {
      throw new BadRequestException('Invalid message cursor');
    }
  }

  private buildAppointmentFollowUpText(params: {
    specialty?: string;
    reason?: string;
    doctorName?: string;
  }): string {
    const details = [params.specialty, params.reason].filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    );

    if (params.doctorName?.trim()) {
      return details.length > 0
        ? `Appointment follow-up requested with ${params.doctorName.trim()} for ${details.join(' - ')}.`
        : `Appointment follow-up requested with ${params.doctorName.trim()}.`;
    }

    if (details.length > 0) {
      return `Appointment follow-up requested for ${details.join(' - ')}.`;
    }

    return 'Appointment follow-up requested.';
  }

  private toObjectId(value: string) {
    return new Types.ObjectId(value);
  }
}
