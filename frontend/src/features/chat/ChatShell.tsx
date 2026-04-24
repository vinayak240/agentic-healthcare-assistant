import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AppBrand, NurseLogo } from '../../components/AppLogo';
import { apiClient } from '../../lib/api/client';
import type {
  AppointmentFollowUpConfirmationMetadata,
  ChatStreamEvent,
  ConversationMessage,
  ConversationSummary,
  ConversationToolEvent,
  MessageAudioMetadata,
  MessageMetadata,
  User,
  UserUsageResponse,
} from '../../lib/api/types';

type TimelineItem =
  | {
      id: string;
      kind: 'message';
      role: 'user' | 'assistant';
      text: string;
      runId?: string;
      metadata?: MessageMetadata;
      audio?: MessageAudioMetadata;
      createdAt?: string | null;
      pending?: boolean;
      toolActivities?: ToolActivity[];
      reasoning?: ReasoningActivity;
    }
  | {
      id: string;
      kind: 'warning';
      message: string;
    };

interface ToolActivity {
  id: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  status: 'pending' | 'running' | 'completed';
}

interface ReasoningActivity {
  text: string;
  streaming: boolean;
}

interface PayloadField {
  label: string;
  value: string;
}

interface PayloadGroup {
  label: string;
  fields: PayloadField[];
}

interface ParsedPayload {
  text?: string;
  fields: PayloadField[];
  lists: Array<{ label: string; items: string[] }>;
  groups: PayloadGroup[];
  raw?: string;
}

interface BookAppointmentContact {
  doctorName: string;
  specialty: string;
  phone: string;
  availabilityNote?: string;
}

interface BookAppointmentOutput {
  status: 'human_follow_up_required';
  contacts: BookAppointmentContact[];
}

interface ChatShellProps {
  user: User;
  onLogout: () => void;
  backendHealthy: boolean;
  bootError: string | null;
}

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionResultList {
  readonly length: number;
  [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

const VOICE_AUTO_SUBMIT_DELAY_MS = 1500;
const VOICE_UNSUPPORTED_MESSAGE = 'Voice input is not supported in this browser. Try Chrome or Edge.';
const VOICE_PERMISSION_MESSAGE =
  'Microphone access was blocked. Please allow microphone permissions and try again.';
const AUTO_SPEAK_STORAGE_KEY = 'medibuddy:auto-speak';
const GLOBAL_TOKEN_LIMIT = 200_000;

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isPersistedMessageId(value: string): boolean {
  return /^[a-f\d]{24}$/i.test(value);
}

function deriveConversationTitle(message: string): string {
  const trimmed = message.trim();

  if (trimmed.length <= 60) {
    return trimmed;
  }

  return `${trimmed.slice(0, 57)}...`;
}

function formatConversationCardTitle(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);

  if (words.length <= 5) {
    return title;
  }

  return `${words.slice(0, 5).join(' ')}...`;
}

function mergeVoiceComposerText(baseText: string, transcript: string): string {
  const nextTranscript = transcript.trim();

  if (!nextTranscript) {
    return baseText;
  }

  const trimmedBase = baseText.trimEnd();

  if (!trimmedBase) {
    return nextTranscript;
  }

  return `${trimmedBase} ${nextTranscript}`;
}

function formatTime(value: string | null): string {
  if (!value) {
    return 'Just now';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return 'Just now';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatTokenCount(value: number): string {
  if (value >= 1000) {
    const thousands = value / 1000;
    const formatted = Number.isInteger(thousands)
      ? thousands.toLocaleString()
      : thousands.toLocaleString(undefined, {
          maximumFractionDigits: 1,
          minimumFractionDigits: 1,
        });

    return `${formatted}K`;
  }

  return value.toLocaleString();
}

function serializeData(value: unknown): string {
  if (value == null) {
    return 'No details';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isMessageGenerationMetadata(value: MessageMetadata | undefined): value is NonNullable<MessageMetadata> {
  return Boolean(value && isRecord(value));
}

function getMessageAudio(metadata?: MessageMetadata): MessageAudioMetadata | undefined {
  if (!isRecord(metadata) || !isRecord(metadata.audio) || metadata.audio.status !== 'ready') {
    return undefined;
  }

  return metadata.audio as unknown as MessageAudioMetadata;
}

function getLatestReasoningText(reasoning?: ReasoningActivity): string {
  if (!reasoning?.text) {
    return '';
  }

  const lines = reasoning.text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.at(-1) ?? '';
}

function isAppointmentFollowUpMetadata(
  value: unknown,
): value is AppointmentFollowUpConfirmationMetadata {
  return (
    isRecord(value) &&
    value.kind === 'appointment_follow_up_confirmation' &&
    typeof value.handoffRunId === 'string' &&
    value.toolName === 'book_appointment'
  );
}

function isBookAppointmentContact(value: unknown): value is BookAppointmentContact {
  return (
    isRecord(value) &&
    typeof value.doctorName === 'string' &&
    typeof value.specialty === 'string' &&
    typeof value.phone === 'string' &&
    (value.availabilityNote === undefined || typeof value.availabilityNote === 'string')
  );
}

function isBookAppointmentOutput(value: unknown): value is BookAppointmentOutput {
  return (
    isRecord(value) &&
    value.status === 'human_follow_up_required' &&
    Array.isArray(value.contacts) &&
    value.contacts.every((contact) => isBookAppointmentContact(contact))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatFieldLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (match) => match.toUpperCase());
}

function formatPrimitive(value: string | number | boolean): string {
  return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
}

function parsePayload(value: unknown): ParsedPayload {
  if (value == null) {
    return {
      text: 'No details',
      fields: [],
      lists: [],
      groups: [],
    };
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return {
      text: formatPrimitive(value),
      fields: [],
      lists: [],
      groups: [],
    };
  }

  if (Array.isArray(value)) {
    const primitiveItems = value.filter(
      (item): item is string | number | boolean =>
        typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
    );

    const objectGroups = value
      .map((item, index) => {
        if (!isRecord(item)) {
          return null;
        }

        const fields = Object.entries(item)
          .filter(
            (entry): entry is [string, string | number | boolean] =>
              typeof entry[1] === 'string' ||
              typeof entry[1] === 'number' ||
              typeof entry[1] === 'boolean',
          )
          .map(([key, itemValue]) => ({
            label: formatFieldLabel(key),
            value: formatPrimitive(itemValue),
          }));

        if (fields.length === 0) {
          return null;
        }

        return {
          label: `Item ${index + 1}`,
          fields,
        };
      })
      .filter((group): group is PayloadGroup => group !== null);

    return {
      fields: [],
      lists:
        primitiveItems.length > 0
          ? [
              {
                label: 'Items',
                items: primitiveItems.map((item) => formatPrimitive(item)),
              },
            ]
          : [],
      groups: objectGroups,
      raw: serializeData(value),
    };
  }

  if (!isRecord(value)) {
    return {
      text: String(value),
      fields: [],
      lists: [],
      groups: [],
    };
  }

  const fields: PayloadField[] = [];
  const lists: Array<{ label: string; items: string[] }> = [];
  const groups: PayloadGroup[] = [];

  for (const [key, entryValue] of Object.entries(value)) {
    const label = formatFieldLabel(key);

    if (
      typeof entryValue === 'string' ||
      typeof entryValue === 'number' ||
      typeof entryValue === 'boolean'
    ) {
      fields.push({
        label,
        value: formatPrimitive(entryValue),
      });
      continue;
    }

    if (Array.isArray(entryValue)) {
      const primitiveItems = entryValue.filter(
        (item): item is string | number | boolean =>
          typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
      );

      if (primitiveItems.length > 0) {
        lists.push({
          label,
          items: primitiveItems.map((item) => formatPrimitive(item)),
        });
        continue;
      }
    }

    if (isRecord(entryValue)) {
      const nestedFields = Object.entries(entryValue)
        .filter(
          (entry): entry is [string, string | number | boolean] =>
            typeof entry[1] === 'string' ||
            typeof entry[1] === 'number' ||
            typeof entry[1] === 'boolean',
        )
        .map(([nestedKey, nestedValue]) => ({
          label: formatFieldLabel(nestedKey),
          value: formatPrimitive(nestedValue),
        }));

      if (nestedFields.length > 0) {
        groups.push({
          label,
          fields: nestedFields,
        });
        continue;
      }
    }
  }

  return {
    fields,
    lists,
    groups,
    raw: serializeData(value),
  };
}

function attachToolActivities(
  messages: ConversationMessage[],
  toolEvents: ConversationToolEvent[],
): TimelineItem[] {
  const activitiesByRunId = new Map<string, ToolActivity[]>();
  const activeIdsByRunAndTool = new Map<string, string[]>();
  const reasoningByRunId = new Map<string, string[]>();
  const usageByRunId = new Map<string, MessageMetadata>();

  for (const event of toolEvents) {
    if (event.type === 'reasoning_delta') {
      const existingReasoning = reasoningByRunId.get(event.runId) ?? [];
      reasoningByRunId.set(event.runId, [
        ...existingReasoning,
        event.payload.text ?? 'Completed a reasoning step.',
      ]);
      continue;
    }

    if (event.type === 'usage_final') {
      usageByRunId.set(event.runId, {
        ...(usageByRunId.get(event.runId) ?? {}),
        ...(typeof event.payload.modelName === 'string' ? { modelName: event.payload.modelName } : {}),
        ...(typeof event.payload.totalTokens === 'number' ? { totalTokens: event.payload.totalTokens } : {}),
        ...(typeof event.payload.costUsd === 'number' ? { costUsd: event.payload.costUsd } : {}),
      });
      continue;
    }

    const existing = activitiesByRunId.get(event.runId) ?? [];

    if (event.type === 'tool_called') {
      const activityId = event.id;
      const queueKey = `${event.runId}:${event.payload.toolName ?? 'tool'}`;
      const queue = activeIdsByRunAndTool.get(queueKey) ?? [];
      activeIdsByRunAndTool.set(queueKey, [...queue, activityId]);
      activitiesByRunId.set(event.runId, [
        ...existing,
        {
          id: activityId,
          toolName: event.payload.toolName ?? 'Tool',
          input: event.payload.toolData,
          status: 'running',
        },
      ]);
      continue;
    }

    const queueKey = `${event.runId}:${event.payload.toolName ?? 'tool'}`;
    const queue = activeIdsByRunAndTool.get(queueKey) ?? [];
    const activityId = queue[0];
    activeIdsByRunAndTool.set(queueKey, queue.slice(1));

    if (!activityId) {
      activitiesByRunId.set(event.runId, [
        ...existing,
        {
          id: event.id,
          toolName: event.payload.toolName ?? 'Tool',
          output: event.payload.toolData,
          status: 'completed',
        },
      ]);
      continue;
    }

    activitiesByRunId.set(
      event.runId,
      existing.map((activity) =>
        activity.id === activityId
          ? {
              ...activity,
              output: event.payload.toolData,
              status: 'completed',
            }
          : activity,
      ),
    );
  }

  return [...messages]
    .reverse()
    .filter(
      (
        message,
      ): message is ConversationMessage & {
        role: 'user' | 'assistant';
      } => message.role === 'user' || message.role === 'assistant',
    )
    .map((message) => ({
      ...conversationMessageToTimelineItem(message),
      metadata: {
        ...(isRecord(message.metadata) ? message.metadata : {}),
        ...(usageByRunId.get(message.runId) ?? {}),
      },
      reasoning:
        reasoningByRunId.has(message.runId)
          ? {
              text: (reasoningByRunId.get(message.runId) ?? []).join('\n'),
              streaming: false,
            }
          : undefined,
      toolActivities:
        message.role === 'assistant' ? activitiesByRunId.get(message.runId) ?? [] : [],
    }));
}

function updateMessageItem(
  items: TimelineItem[],
  messageId: string,
  update: (item: Extract<TimelineItem, { kind: 'message' }>) => TimelineItem,
): TimelineItem[] {
  return items.map((item) => (item.id === messageId && item.kind === 'message' ? update(item) : item));
}

function mapMessagesToTimeline(messages: ConversationMessage[]): TimelineItem[] {
  return [...messages]
    .reverse()
    .filter(
      (
        message,
      ): message is ConversationMessage & {
        role: 'user' | 'assistant';
      } => message.role === 'user' || message.role === 'assistant',
    )
    .map((message) => conversationMessageToTimelineItem(message));
}

function conversationMessageToTimelineItem(
  message: ConversationMessage & { role: 'user' | 'assistant' },
): TimelineItem {
  return {
    id: message.id,
    kind: 'message',
    role: message.role,
    text: message.text,
    runId: message.runId,
    metadata: message.metadata,
    audio: getMessageAudio(message.metadata),
    createdAt: message.createdAt,
    toolActivities: [],
  };
}

function ToolPayloadView({ title, value }: { title: string; value: unknown }) {
  const parsed = parsePayload(value);

  return (
    <div className="rounded-[14px] bg-white/90 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6f80b3]">{title}</p>

      {parsed.text && <p className="mt-3 text-sm leading-6 text-slate-700">{parsed.text}</p>}

      {parsed.fields.length > 0 && (
        <dl className="mt-3 space-y-2">
          {parsed.fields.map((field) => (
            <div
              key={`${title}-${field.label}`}
              className="flex flex-wrap items-start justify-between gap-3 rounded-[12px] bg-[#f6f8ff] px-3 py-2"
            >
              <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f80b3]">
                {field.label}
              </dt>
              <dd className="max-w-[70%] text-right text-sm text-slate-700">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {parsed.lists.map((list) => (
        <div key={`${title}-${list.label}`} className="mt-3 rounded-[12px] bg-[#f6f8ff] px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f80b3]">
            {list.label}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {list.items.map((item, index) => (
              <li key={`${list.label}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ))}

      {parsed.groups.map((group) => (
        <div key={`${title}-${group.label}`} className="mt-3 rounded-[12px] bg-[#f6f8ff] px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f80b3]">
            {group.label}
          </p>
          <dl className="mt-2 space-y-2">
            {group.fields.map((field) => (
              <div key={`${group.label}-${field.label}`} className="flex flex-wrap items-start justify-between gap-3">
                <dt className="text-sm font-medium text-slate-600">{field.label}</dt>
                <dd className="max-w-[70%] text-right text-sm text-slate-700">{field.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}

      {parsed.raw && parsed.fields.length === 0 && parsed.lists.length === 0 && parsed.groups.length === 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-[#6f80b3]">
            Raw details
          </summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-slate-600">
            {parsed.raw}
          </pre>
        </details>
      )}

      {parsed.raw && (parsed.fields.length > 0 || parsed.lists.length > 0 || parsed.groups.length > 0) && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-[#6f80b3]">
            Raw JSON
          </summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-slate-600">
            {parsed.raw}
          </pre>
        </details>
      )}
    </div>
  );
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="chat-markdown mt-3 text-sm leading-7">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function MessageAudioPlayer({
  audio,
  playRequestId,
}: {
  audio: MessageAudioMetadata;
  playRequestId?: number;
}) {
  const playableChunks = audio.chunks
    .filter((chunk) => typeof chunk.url === 'string' && chunk.url.length > 0)
    .sort((left, right) => left.index - right.index);
  const [chunkIndex, setChunkIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeChunk = playableChunks[chunkIndex] ?? playableChunks[0];

  useEffect(() => {
    setChunkIndex(0);
  }, [audio.generatedAt]);

  useEffect(() => {
    if (!playRequestId || !activeChunk?.url) {
      return;
    }

    const player = audioRef.current;
    void player?.play().catch(() => undefined);
  }, [activeChunk?.url, playRequestId]);

  if (!activeChunk?.url) {
    return null;
  }

  return (
    <div className="mt-3 rounded-[14px] border border-[#dfe7ff] bg-[#f8faff] px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5d75c9]">
        <span>AI voice</span>
        {playableChunks.length > 1 && (
          <span>
            {chunkIndex + 1}/{playableChunks.length}
          </span>
        )}
      </div>
      <audio
        ref={audioRef}
        src={activeChunk.url}
        controls
        className="h-10 w-full"
        onEnded={() => {
          if (chunkIndex < playableChunks.length - 1) {
            setChunkIndex((current) => current + 1);
          }
        }}
      />
    </div>
  );
}

function MessageMetadataRow({
  createdAt,
  metadata,
  hasReasoning,
  reasoningExpanded,
  onToggleReasoning,
  hasToolActivity,
  toolActivityExpanded,
  toolActivityBusy,
  onToggleToolActivity,
  hasAudioAction,
  audioActionBusy,
  audioActionLabel,
  onAudioAction,
  hasDeleteAction,
  deleteActionBusy,
  onDeleteAction,
}: {
  createdAt?: string | null;
  metadata?: MessageMetadata;
  hasReasoning?: boolean;
  reasoningExpanded?: boolean;
  onToggleReasoning?: () => void;
  hasToolActivity?: boolean;
  toolActivityExpanded?: boolean;
  toolActivityBusy?: boolean;
  onToggleToolActivity?: () => void;
  hasAudioAction?: boolean;
  audioActionBusy?: boolean;
  audioActionLabel?: string;
  onAudioAction?: () => void;
  hasDeleteAction?: boolean;
  deleteActionBusy?: boolean;
  onDeleteAction?: () => void;
}) {
  const safeMetadata = isMessageGenerationMetadata(metadata) ? metadata : null;
  const parts = [
    formatDateTime(createdAt),
    safeMetadata?.modelName,
    typeof safeMetadata?.costUsd === 'number'
      ? `$${safeMetadata.costUsd.toFixed(4)}`
      : undefined,
  ].filter((part): part is string => Boolean(part));

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-slate-400">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>{part}</span>
      ))}
      {hasToolActivity && (
        <button
          type="button"
          onClick={onToggleToolActivity}
          className="text-inherit underline underline-offset-2 transition hover:text-[#4d69c5]"
        >
          {toolActivityExpanded ? 'Hide Tool Activity' : toolActivityBusy ? 'Using tools' : 'Tool Activity'}
        </button>
      )}
      {hasReasoning && (
        <button
          type="button"
          onClick={onToggleReasoning}
          className="text-inherit underline underline-offset-2 transition hover:text-[#4d69c5]"
        >
          {reasoningExpanded ? 'Hide Reasoning' : 'Show Reasoning'}
        </button>
      )}
      {hasAudioAction && (
        <button
          type="button"
          onClick={onAudioAction}
          disabled={audioActionBusy}
          className="text-inherit underline underline-offset-2 transition hover:text-[#4d69c5] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {audioActionBusy ? 'Preparing voice' : audioActionLabel ?? 'Play voice'}
        </button>
      )}
      {hasDeleteAction && (
        <button
          type="button"
          onClick={onDeleteAction}
          disabled={deleteActionBusy}
          className={`text-rose-500 underline underline-offset-2 transition hover:text-rose-600 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-50 ${
            deleteActionBusy ? 'opacity-100' : 'opacity-0 group-hover/message-row:opacity-100'
          }`}
        >
          {deleteActionBusy ? 'Deleting' : 'Delete'}
        </button>
      )}
    </div>
  );
}

function ReasoningPanel({
  reasoning,
}: {
  reasoning: ReasoningActivity;
}) {
  return (
    <div className="mt-3 rounded-[16px] border border-[#dfe7ff] bg-[#f8faff] px-4 py-3 text-sm text-slate-700">
      <div className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#5d75c9]">
          {reasoning.streaming && <span className="h-2 w-2 animate-pulse rounded-full bg-[#3867ff]" />}
          Reasoning
        </span>
      </div>

      <div className="mt-3 whitespace-pre-wrap rounded-[12px] bg-white/80 px-3 py-3 text-sm leading-6 text-slate-600">
        {reasoning.text}
      </div>
    </div>
  );
}

function ToolActivityPanel({
  activities,
  requestedRunIds,
  requestingRunIds,
  parentRunId,
  onRequestAppointment,
}: {
  activities: ToolActivity[];
  requestedRunIds: Set<string>;
  requestingRunIds: Record<string, boolean>;
  parentRunId?: string;
  onRequestAppointment: (input: {
    runId: string;
    contact: BookAppointmentContact;
    specialty?: string;
    reason?: string;
  }) => void;
}) {
  return (
    <div className="mt-4 space-y-3 rounded-[16px] border border-[#e2e8ff] bg-[#f7f9ff] px-4 py-4 text-sm text-slate-700 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#6f80b3]">
            Tool activity
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {activities.length} {activities.length === 1 ? 'tool call' : 'tool calls'}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {activities.map((activity) => (
          <div key={activity.id} className="rounded-[14px] border border-white/80 bg-white/95 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-[12px] ${
                    activity.status === 'pending'
                      ? 'bg-amber-50 text-amber-600'
                      : activity.status === 'running'
                      ? 'bg-[#e8eeff] text-[#3867ff]'
                      : 'bg-[#ebfff5] text-emerald-600'
                  }`}
                >
                  {activity.status === 'pending' || activity.status === 'running' ? (
                    <span
                      className={`h-3 w-3 rounded-full bg-current ${
                        activity.status === 'running' ? 'animate-ping' : 'animate-pulse'
                      }`}
                    />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                      <path
                        d="m7.75 12.25 2.75 2.75 5.75-6.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{activity.toolName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {activity.status === 'pending'
                      ? 'Queued'
                      : activity.status === 'running'
                        ? 'Running now'
                        : 'Completed'}
                  </p>
                </div>
              </div>

              <span
                className={`rounded-[12px] px-3 py-1 text-xs font-semibold ${
                  activity.status === 'running'
                    ? 'bg-[#e9efff] text-[#3f66d4]'
                    : activity.status === 'pending'
                      ? 'bg-amber-50 text-amber-700'
                    : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {activity.status === 'pending'
                  ? 'Pending'
                  : activity.status === 'running'
                    ? 'Running'
                    : 'Completed'}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              {activity.input !== undefined && <ToolPayloadView title="Tool input" value={activity.input} />}
              {activity.output !== undefined &&
                (activity.toolName === 'book_appointment' && isBookAppointmentOutput(activity.output) ? (
                  <AppointmentHandoffCard
                    output={activity.output}
                    input={activity.input}
                    requested={Boolean(parentRunId && requestedRunIds.has(parentRunId))}
                    requesting={Boolean(parentRunId && requestingRunIds[parentRunId])}
                    onRequest={
                      parentRunId
                        ? (contact) =>
                            onRequestAppointment({
                              runId: parentRunId,
                              contact,
                              specialty:
                                isRecord(activity.input) && typeof activity.input.specialty === 'string'
                                  ? activity.input.specialty
                                  : undefined,
                              reason:
                                isRecord(activity.input) && typeof activity.input.reason === 'string'
                                  ? activity.input.reason
                                  : undefined,
                            })
                        : undefined
                    }
                  />
                ) : (
                  <ToolPayloadView title="Tool output" value={activity.output} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AppointmentHandoffCard({
  output,
  input,
  requested,
  requesting,
  onRequest,
}: {
  output: BookAppointmentOutput;
  input?: unknown;
  requested: boolean;
  requesting: boolean;
  onRequest?: (contact: BookAppointmentContact) => void;
}) {
  const specialty =
    isRecord(input) && typeof input.specialty === 'string' ? input.specialty : undefined;
  const reason = isRecord(input) && typeof input.reason === 'string' ? input.reason : undefined;

  return (
    <div className="rounded-[16px] border border-[#dbe6ff] bg-[linear-gradient(180deg,#f8fbff_0%,#eef5ff_100%)] px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5d75c9]">
            Human follow-up required
          </p>
          <h4 className="mt-2 text-base font-semibold text-slate-950">Appointment handoff</h4>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#4d69c5]">
              <NurseLogo className="h-4 w-4" />
              <span>MediBuddy</span>
            </span>{' '}
            found contact options, but a person still needs to complete the appointment request.
          </p>
        </div>

        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            requested
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-[#e9efff] text-[#3f66d4]'
          }`}
        >
          {requested ? 'Requested' : 'Awaiting confirmation'}
        </span>
      </div>

      {(specialty || reason) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {specialty && (
            <span className="rounded-[12px] bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700">
              Specialty: {specialty}
            </span>
          )}
          {reason && (
            <span className="rounded-[12px] bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700">
              Reason: {reason}
            </span>
          )}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {output.contacts.map((contact) => (
          <div
            key={`${contact.doctorName}-${contact.phone}`}
            className="rounded-[14px] border border-white/90 bg-white/95 px-4 py-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-950">{contact.doctorName}</p>
                <p className="mt-1 text-sm text-slate-600">{contact.specialty}</p>
                <p className="mt-2 text-sm font-medium text-[#3356c8]">{contact.phone}</p>
                {contact.availabilityNote && (
                  <p className="mt-2 text-sm leading-6 text-slate-500">{contact.availabilityNote}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onRequest?.(contact)}
                  disabled={requested || requesting || !onRequest}
                  className="rounded-[12px] bg-[linear-gradient(135deg,#3867ff_0%,#6287ff_100%)] px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(56,103,255,0.2)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {requested ? 'Appointment Requested' : requesting ? 'Requesting...' : 'Book Appointment'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-[#6f80b3]">
          Raw tool details
        </summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-slate-600">
          {serializeData(output)}
        </pre>
      </details>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M12 15.25a3.75 3.75 0 0 0 3.75-3.75v-3a3.75 3.75 0 1 0-7.5 0v3A3.75 3.75 0 0 0 12 15.25Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5.75 11.75a6.25 6.25 0 0 0 12.5 0M12 18v2.25M8.5 20.25h7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M20.1 3.9 10.88 13.12M20.1 3.9 14.24 20.1l-3.36-6.98L3.9 9.76 20.1 3.9Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="m6.75 6.75 10.5 10.5M17.25 6.75l-10.5 10.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M4.75 7.25h14.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M9.25 7.25V5.75A1.75 1.75 0 0 1 11 4h2a1.75 1.75 0 0 1 1.75 1.75v1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.25 7.25l.65 10.1A2.75 2.75 0 0 0 10.64 20h2.72a2.75 2.75 0 0 0 2.74-2.65l.65-10.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10.5 11v5M13.5 11v5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ConversationIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M5.75 5.25h12.5A2.75 2.75 0 0 1 21 8v6.25A2.75 2.75 0 0 1 18.25 17H11l-4.5 3.25V17h-.75A2.75 2.75 0 0 1 3 14.25V8a2.75 2.75 0 0 1 2.75-2.75Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M7.75 9.25h8.5M7.75 12.75h5.75"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M14.25 8.25V6.5a2.75 2.75 0 0 0-2.75-2.75h-4A2.75 2.75 0 0 0 4.75 6.5v11A2.75 2.75 0 0 0 7.5 20.25h4a2.75 2.75 0 0 0 2.75-2.75v-1.75"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10.75 12h8m0 0-2.75-2.75M18.75 12l-2.75 2.75"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChatShell({ user, onLogout, backendHealthy, bootError }: ChatShellProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [expandedToolActivityIds, setExpandedToolActivityIds] = useState<Record<string, boolean>>({});
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Record<string, boolean>>({});
  const [deletingMessageIds, setDeletingMessageIds] = useState<Record<string, boolean>>({});
  const [deletingConversationIds, setDeletingConversationIds] = useState<Record<string, boolean>>({});
  const [conversationPendingDelete, setConversationPendingDelete] =
    useState<ConversationSummary | null>(null);
  const [appointmentFollowUpSubmittingRunIds, setAppointmentFollowUpSubmittingRunIds] = useState<
    Record<string, boolean>
  >({});
  const [composer, setComposer] = useState('');
  const [pending, setPending] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [streamStatus, setStreamStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [autoSpeakEnabled, setAutoSpeakEnabled] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(AUTO_SPEAK_STORAGE_KEY) === 'true',
  );
  const [audioGeneratingMessageIds, setAudioGeneratingMessageIds] = useState<Record<string, boolean>>({});
  const [autoPlayingMessageId, setAutoPlayingMessageId] = useState<string | null>(null);
  const [audioPlaybackRequestIds, setAudioPlaybackRequestIds] = useState<Record<string, number>>({});
  const [voiceSupported] = useState(
    () =>
      typeof window !== 'undefined' &&
      Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition),
  );
  const [userUsage, setUserUsage] = useState<Pick<UserUsageResponse, 'totalTokens'>>({
    totalTokens: 0,
  });
  const [activeConversationMeta, setActiveConversationMeta] = useState<ConversationSummary | null>(
    null,
  );
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const threadViewportRef = useRef<HTMLDivElement | null>(null);
  const activeToolIdsRef = useRef<Record<string, string[]>>({});
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const voiceSubmitTimerRef = useRef<number | null>(null);
  const voiceBaseTranscriptRef = useRef('');
  const voiceFinalTranscriptRef = useRef('');
  const voiceCurrentTranscriptRef = useRef('');
  const voiceAutoSubmitArmedRef = useRef(false);
  const pendingRef = useRef(pending);
  const backendHealthyRef = useRef(backendHealthy);
  const autoSpeakEnabledRef = useRef(autoSpeakEnabled);
  const streamingConversationIdRef = useRef<string | null>(null);

  const activeConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === selectedConversationId) ??
      activeConversationMeta,
    [activeConversationMeta, conversations, selectedConversationId],
  );
  const userUsageLimit = GLOBAL_TOKEN_LIMIT;
  const userUsagePercent = Math.min(
    100,
    Math.round((userUsage.totalTokens / userUsageLimit) * 100),
  );
  const conversationTokenTotal = useMemo(
    () =>
      timelineItems.reduce((total, item) => {
        if (item.kind !== 'message' || item.role !== 'assistant') {
          return total;
        }

        const metadata = isMessageGenerationMetadata(item.metadata) ? item.metadata : null;

        return total + (metadata?.totalTokens ?? 0);
      }, 0),
    [timelineItems],
  );

  const requestedAppointmentRunIds = useMemo(() => {
    const runIds = new Set<string>();

    for (const item of timelineItems) {
      if (
        item.kind === 'message' &&
        item.metadata &&
        isAppointmentFollowUpMetadata(item.metadata)
      ) {
        runIds.add(item.metadata.handoffRunId);
      }
    }

    return runIds;
  }, [timelineItems]);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    autoSpeakEnabledRef.current = autoSpeakEnabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem(AUTO_SPEAK_STORAGE_KEY, String(autoSpeakEnabled));
    }
  }, [autoSpeakEnabled]);

  useEffect(() => {
    backendHealthyRef.current = backendHealthy;
  }, [backendHealthy]);

  useEffect(() => {
    let active = true;

    const loadUserUsage = async () => {
      try {
        const response = await apiClient.getUserUsage(user.id);

        if (active) {
          setUserUsage({ totalTokens: response.totalTokens });
        }
      } catch {
        if (active) {
          setUserUsage({ totalTokens: 0 });
        }
      }
    };

    void loadUserUsage();

    return () => {
      active = false;
    };
  }, [user.id]);

  useEffect(() => {
    let active = true;

    const loadConversations = async () => {
      setLoadingConversations(true);

      try {
        const response = await apiClient.listConversations(user.id);

        if (!active) {
          return;
        }

        setConversations(response.items);
        setActiveConversationMeta(null);

        if (!selectedConversationId && response.items.length > 0) {
          setSelectedConversationId(response.items[0].id);
        }
      } catch (conversationError) {
        if (!active) {
          return;
        }

        setError(
          conversationError instanceof Error
            ? conversationError.message
            : 'Could not load conversation history.',
        );
      } finally {
        if (active) {
          setLoadingConversations(false);
        }
      }
    };

    void loadConversations();

    return () => {
      active = false;
    };
  }, [user.id]);

  useEffect(() => {
    if (!selectedConversationId) {
      setTimelineItems([]);
      setExpandedToolActivityIds({});
      setExpandedReasoningIds({});
      setAppointmentFollowUpSubmittingRunIds({});
      setAudioGeneratingMessageIds({});
      setAutoPlayingMessageId(null);
      setAudioPlaybackRequestIds({});
      setLoadingMessages(false);
      return;
    }

    if (streamingConversationIdRef.current === selectedConversationId) {
      setLoadingMessages(false);
      return;
    }

    let active = true;

    const loadMessages = async () => {
      setLoadingMessages(true);
      setError(null);

      try {
        const [messageResponse, toolEventResponse] = await Promise.all([
          apiClient.listMessages(selectedConversationId),
          apiClient.listConversationToolEvents(selectedConversationId),
        ]);

        if (!active) {
          return;
        }

        setTimelineItems(attachToolActivities(messageResponse.items, toolEventResponse.items));
        setExpandedToolActivityIds({});
        setExpandedReasoningIds({});
        setAppointmentFollowUpSubmittingRunIds({});
        setAudioGeneratingMessageIds({});
        setAutoPlayingMessageId(null);
        setAudioPlaybackRequestIds({});
      } catch (messageError) {
        if (!active) {
          return;
        }

        setError(
          messageError instanceof Error
            ? messageError.message
            : 'Could not load messages for this conversation.',
        );
      } finally {
        if (active) {
          setLoadingMessages(false);
        }
      }
    };

    void loadMessages();

    return () => {
      active = false;
    };
  }, [selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    const matchedConversation =
      conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;

    if (matchedConversation) {
      setActiveConversationMeta(matchedConversation);
    }
  }, [conversations, selectedConversationId]);

  useEffect(() => {
    const node = composerRef.current;

    if (!node) {
      return;
    }

    node.style.height = '0px';
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }, [composer]);

  useEffect(() => {
    const viewport = threadViewportRef.current;

    if (!viewport) {
      return;
    }

    requestAnimationFrame(() => {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: 'smooth',
      });
    });
  }, [timelineItems, loadingMessages]);

  const refreshConversations = async (preferredConversationId?: string) => {
    try {
      const response = await apiClient.listConversations(user.id);
      setConversations(response.items);

      if (preferredConversationId) {
        const match = response.items.find((conversation) => conversation.id === preferredConversationId);

        if (match) {
          setActiveConversationMeta(match);
        }
      }
    } catch {
      // Keep the current UI state if the list refresh fails.
    }
  };

  const clearVoiceSubmitTimer = () => {
    if (voiceSubmitTimerRef.current !== null) {
      window.clearTimeout(voiceSubmitTimerRef.current);
      voiceSubmitTimerRef.current = null;
    }
  };

  const detachRecognitionHandlers = (recognition: BrowserSpeechRecognition | null) => {
    if (!recognition) {
      return;
    }

    recognition.onend = null;
    recognition.onerror = null;
    recognition.onresult = null;
  };

  const resetVoiceTranscriptSession = () => {
    clearVoiceSubmitTimer();
    voiceBaseTranscriptRef.current = '';
    voiceFinalTranscriptRef.current = '';
    voiceCurrentTranscriptRef.current = '';
    voiceAutoSubmitArmedRef.current = false;
  };

  const stopVoiceRecognition = ({
    abort = false,
    clearTimer = true,
  }: {
    abort?: boolean;
    clearTimer?: boolean;
  } = {}) => {
    const recognition = recognitionRef.current;

    if (clearTimer) {
      clearVoiceSubmitTimer();
      voiceAutoSubmitArmedRef.current = false;
    }

    if (!recognition) {
      setVoiceListening(false);
      return;
    }

    detachRecognitionHandlers(recognition);
    recognitionRef.current = null;

    try {
      if (abort) {
        recognition.abort();
      } else {
        recognition.stop();
      }
    } catch {
      // The browser may already have ended the recognition session.
    }

    setVoiceListening(false);
  };

  const scheduleVoiceAutoSubmit = (message: string) => {
    clearVoiceSubmitTimer();

    if (!message.trim()) {
      voiceAutoSubmitArmedRef.current = false;
      return;
    }

    voiceAutoSubmitArmedRef.current = true;
    voiceSubmitTimerRef.current = window.setTimeout(() => {
      const nextMessage = voiceCurrentTranscriptRef.current.trim()
        ? mergeVoiceComposerText(voiceBaseTranscriptRef.current, voiceCurrentTranscriptRef.current)
        : message;

      voiceSubmitTimerRef.current = null;
      voiceAutoSubmitArmedRef.current = false;
      stopVoiceRecognition({ abort: false, clearTimer: false });

      if (!nextMessage.trim() || pendingRef.current || !backendHealthyRef.current) {
        return;
      }

      void submitMessage(nextMessage);
    }, VOICE_AUTO_SUBMIT_DELAY_MS);
  };

  const handleVoiceTranscript = (event: BrowserSpeechRecognitionEvent) => {
    let nextFinalTranscript = voiceFinalTranscriptRef.current;
    let interimTranscript = '';

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript.trim() ?? '';

      if (!transcript) {
        continue;
      }

      if (result.isFinal) {
        nextFinalTranscript = [nextFinalTranscript, transcript].filter(Boolean).join(' ');
      } else {
        interimTranscript = [interimTranscript, transcript].filter(Boolean).join(' ');
      }
    }

    voiceFinalTranscriptRef.current = nextFinalTranscript.trim();

    const visibleTranscript = [voiceFinalTranscriptRef.current, interimTranscript]
      .filter(Boolean)
      .join(' ')
      .trim();
    voiceCurrentTranscriptRef.current = visibleTranscript;

    const nextComposer = mergeVoiceComposerText(voiceBaseTranscriptRef.current, visibleTranscript);
    setComposer(nextComposer);
    setVoiceError(null);
    scheduleVoiceAutoSubmit(nextComposer);
  };

  const handleVoiceError = (event: BrowserSpeechRecognitionErrorEvent) => {
    clearVoiceSubmitTimer();
    voiceAutoSubmitArmedRef.current = false;
    recognitionRef.current = null;
    setVoiceListening(false);

    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      setVoiceError(VOICE_PERMISSION_MESSAGE);
      return;
    }

    if (event.error === 'no-speech') {
      setVoiceError('No speech was detected. Please try voice input again.');
      return;
    }

    setVoiceError('Voice input stopped unexpectedly. Please try again.');
  };

  const startVoiceRecognition = () => {
    if (!voiceSupported) {
      setVoiceError(VOICE_UNSUPPORTED_MESSAGE);
      return;
    }

    if (pending || !backendHealthy) {
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      setVoiceError(VOICE_UNSUPPORTED_MESSAGE);
      return;
    }

    stopVoiceRecognition({ abort: true });
    resetVoiceTranscriptSession();
    setVoiceError(null);

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = handleVoiceTranscript;
    recognition.onerror = handleVoiceError;
    recognition.onend = () => {
      recognitionRef.current = null;
      setVoiceListening(false);
    };

    voiceBaseTranscriptRef.current = composer;
    recognitionRef.current = recognition;

    try {
      recognition.start();
      setVoiceListening(true);
    } catch {
      recognitionRef.current = null;
      setVoiceListening(false);
      setVoiceError('Voice input could not start. Please try again.');
    }
  };

  const handleVoiceButtonClick = () => {
    if (voiceListening) {
      const hasVoiceTranscript = voiceCurrentTranscriptRef.current.trim().length > 0;
      stopVoiceRecognition({ abort: false, clearTimer: false });

      if (hasVoiceTranscript) {
        scheduleVoiceAutoSubmit(composer);
      }

      return;
    }

    startVoiceRecognition();
  };

  const handleVoiceCancel = () => {
    const baseText = voiceBaseTranscriptRef.current;

    stopVoiceRecognition({ abort: true });
    resetVoiceTranscriptSession();
    setComposer(baseText);
    setVoiceError(null);
  };

  const handleComposerChange = (value: string) => {
    setComposer(value);

    if (!voiceListening) {
      return;
    }

    const visibleTranscript = voiceCurrentTranscriptRef.current;

    if (visibleTranscript && value.endsWith(visibleTranscript)) {
      voiceBaseTranscriptRef.current = value.slice(0, value.length - visibleTranscript.length).trimEnd();
      return;
    }

    voiceBaseTranscriptRef.current = value;
  };

  const attachMessageAudio = (messageId: string, audio: MessageAudioMetadata) => {
    setTimelineItems((current) =>
      updateMessageItem(current, messageId, (item) => ({
        ...item,
        audio,
        metadata: {
          ...(isRecord(item.metadata) ? item.metadata : {}),
          audio,
        },
      })),
    );
  };

  const requestMessageAudioPlayback = (messageId: string) => {
    setAutoPlayingMessageId(messageId);
    setAudioPlaybackRequestIds((current) => ({
      ...current,
      [messageId]: (current[messageId] ?? 0) + 1,
    }));
  };

  const generateMessageAudio = async (input: {
    conversationId: string;
    messageId: string;
    autoPlay?: boolean;
  }) => {
    if (audioGeneratingMessageIds[input.messageId]) {
      return;
    }

    setAudioGeneratingMessageIds((current) => ({ ...current, [input.messageId]: true }));

    try {
      const audio = await apiClient.createMessageAudio(input.conversationId, input.messageId);
      attachMessageAudio(input.messageId, audio);

      if (input.autoPlay) {
        requestMessageAudioPlayback(input.messageId);
      }
    } catch {
      // TTS is best-effort and should never interrupt chat.
    } finally {
      setAudioGeneratingMessageIds((current) => ({ ...current, [input.messageId]: false }));
    }
  };

  const handlePlayMessageAudio = (item: Extract<TimelineItem, { kind: 'message' }>) => {
    const conversationId = selectedConversationId ?? activeConversation?.id;

    if (!conversationId || item.pending || item.role !== 'assistant' || !isPersistedMessageId(item.id)) {
      return;
    }

    if (item.audio) {
      requestMessageAudioPlayback(item.id);
      return;
    }

    void generateMessageAudio({
      conversationId,
      messageId: item.id,
      autoPlay: true,
    });
  };

  const submitMessage = async (message: string) => {
    const nextMessage = message.trim();

    if (!nextMessage || pendingRef.current || !backendHealthyRef.current) {
      return;
    }

    stopVoiceRecognition({ abort: true });
    resetVoiceTranscriptSession();

    const userMessageId = createId('user');
    const assistantMessageId = createId('assistant');
    const conversationTitle = deriveConversationTitle(nextMessage);
    const existingConversationId = selectedConversationId ?? undefined;
    let streamConversationId = existingConversationId ?? null;

    setComposer('');
    setPending(true);
    pendingRef.current = true;
    setError(null);
    setVoiceError(null);
    setStreamStatus('Starting secure stream');
    activeToolIdsRef.current = {};
    setExpandedToolActivityIds({});
    setExpandedReasoningIds({});

    setTimelineItems((current) => [
      ...current,
      {
        id: userMessageId,
        kind: 'message',
        role: 'user',
        text: nextMessage,
        metadata: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: assistantMessageId,
        kind: 'message',
        role: 'assistant',
        text: '',
        metadata: null,
        createdAt: new Date().toISOString(),
        toolActivities: [],
        pending: true,
      },
    ]);

    try {
      await apiClient.streamChat(
        {
          userId: user.id,
          message: nextMessage,
          conversationId: existingConversationId,
        },
        {
          onEvent: (chatEvent: ChatStreamEvent) => {
            switch (chatEvent.type) {
              case 'run.started': {
                streamConversationId = chatEvent.data.conversationId;
                streamingConversationIdRef.current = chatEvent.data.conversationId;
                setSelectedConversationId(chatEvent.data.conversationId);
                setActiveConversationMeta((current) => ({
                  id: chatEvent.data.conversationId,
                  userId: user.id,
                  title: current?.title ?? conversationTitle,
                  lastMessageAt: new Date().toISOString(),
                  createdAt: current?.createdAt ?? new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }));
                setTimelineItems((current) =>
                  current.map((item) => {
                    if (item.id === userMessageId && item.kind === 'message' && chatEvent.data.userMessageId) {
                      return {
                        ...item,
                        id: chatEvent.data.userMessageId,
                        runId: chatEvent.runId,
                      };
                    }

                    if (item.id === assistantMessageId && item.kind === 'message') {
                      return {
                        ...item,
                        runId: chatEvent.runId,
                      };
                    }

                    return item;
                  }),
                );
                setStreamStatus('Assistant is reviewing your request');
                break;
              }
              case 'conversation.title.generated': {
                const generatedTitle = chatEvent.data.title.trim();

                if (!generatedTitle) {
                  break;
                }

                setActiveConversationMeta((current) =>
                  current
                    ? {
                        ...current,
                        title: generatedTitle,
                        updatedAt: new Date().toISOString(),
                      }
                    : current,
                );
                setConversations((current) =>
                  current.map((conversation) =>
                    conversation.id === streamConversationId
                      ? {
                          ...conversation,
                          title: generatedTitle,
                          updatedAt: new Date().toISOString(),
                        }
                      : conversation,
                  ),
                );
                break;
              }
              case 'run.completed':
                setStreamStatus('Conversation updated');
                setTimelineItems((current) =>
                  updateMessageItem(current, assistantMessageId, (item) => ({
                    ...item,
                    id: chatEvent.data.assistantMessageId ?? item.id,
                    createdAt: chatEvent.data.createdAt ?? item.createdAt,
                    metadata: chatEvent.data.metadata ?? item.metadata,
                    reasoning: item.reasoning ? { ...item.reasoning, streaming: false } : undefined,
                  })),
                );
                if (
                  autoSpeakEnabledRef.current &&
                  chatEvent.data.conversationId &&
                  chatEvent.data.assistantMessageId
                ) {
                  void generateMessageAudio({
                    conversationId: chatEvent.data.conversationId,
                    messageId: chatEvent.data.assistantMessageId,
                    autoPlay: true,
                  });
                }
                break;
              case 'reasoning.delta':
                setStreamStatus('Reasoning through the request');
                setTimelineItems((current) =>
                  updateMessageItem(current, assistantMessageId, (item) => ({
                    ...item,
                    runId: chatEvent.runId,
                    reasoning: {
                      text: [item.reasoning?.text, chatEvent.data.delta].filter(Boolean).join('\n'),
                      streaming: true,
                    },
                  })),
                );
                break;
              case 'message.delta':
                setStreamStatus('Streaming response');
                setTimelineItems((current) =>
                  current.map((item) =>
                    item.id === assistantMessageId && item.kind === 'message'
                      ? { ...item, text: `${item.text}${chatEvent.data.delta}`, runId: chatEvent.runId }
                      : item,
                  ),
                );
                break;
              case 'message.completed':
                setTimelineItems((current) =>
                  current.map((item) =>
                    item.id === assistantMessageId && item.kind === 'message'
                      ? { ...item, text: chatEvent.data.message, pending: false, runId: chatEvent.runId }
                      : item,
                  ),
                );
                break;
              case 'tool.call.started': {
                const toolId = createId('tool');
                const queue = activeToolIdsRef.current[chatEvent.data.toolName] ?? [];
                activeToolIdsRef.current[chatEvent.data.toolName] = [...queue, toolId];

                setStreamStatus(`Running ${chatEvent.data.toolName}`);
                setTimelineItems((current) =>
                  updateMessageItem(current, assistantMessageId, (item) => ({
                    ...item,
                    runId: chatEvent.runId,
                    toolActivities: [
                      ...(item.toolActivities ?? []),
                      {
                        id: toolId,
                        toolName: chatEvent.data.toolName,
                        input: chatEvent.data.input,
                        status: 'pending',
                      },
                    ],
                  })),
                );
                window.setTimeout(() => {
                  setTimelineItems((current) =>
                    updateMessageItem(current, assistantMessageId, (item) => ({
                      ...item,
                      toolActivities: (item.toolActivities ?? []).map((activity) =>
                        activity.id === toolId && activity.status === 'pending'
                          ? { ...activity, status: 'running' }
                          : activity,
                      ),
                    })),
                  );
                }, 160);
                break;
              }
              case 'tool.call.completed': {
                const queue = activeToolIdsRef.current[chatEvent.data.toolName] ?? [];
                const toolId = queue[0];
                activeToolIdsRef.current[chatEvent.data.toolName] = queue.slice(1);

                setStreamStatus(`Completed ${chatEvent.data.toolName}`);

                if (!toolId) {
                  setTimelineItems((current) =>
                    updateMessageItem(current, assistantMessageId, (item) => ({
                      ...item,
                      runId: chatEvent.runId,
                      toolActivities: [
                        ...(item.toolActivities ?? []),
                        {
                          id: createId('tool'),
                          toolName: chatEvent.data.toolName,
                          output: chatEvent.data.output,
                          status: 'completed',
                        },
                      ],
                    })),
                  );
                  break;
                }

                setTimelineItems((current) =>
                  updateMessageItem(current, assistantMessageId, (item) => ({
                    ...item,
                    runId: chatEvent.runId,
                    toolActivities: (item.toolActivities ?? []).map((activity) =>
                      activity.id === toolId
                        ? { ...activity, output: chatEvent.data.output, status: 'completed' }
                        : activity,
                    ),
                  })),
                );
                break;
              }
              case 'usage.final':
                setUserUsage((current) => ({
                  ...current,
                  totalTokens: current.totalTokens + chatEvent.data.totalTokens,
                }));
                setTimelineItems((current) =>
                  updateMessageItem(current, assistantMessageId, (item) => ({
                    ...item,
                    metadata: {
                      ...(isRecord(item.metadata) ? item.metadata : {}),
                      totalTokens: chatEvent.data.totalTokens,
                      ...(chatEvent.data.modelName ? { modelName: chatEvent.data.modelName } : {}),
                      ...(typeof chatEvent.data.costUsd === 'number'
                        ? { costUsd: chatEvent.data.costUsd }
                        : {}),
                    },
                  })),
                );
                break;
              case 'run.warning':
                setTimelineItems((current) => [
                  ...current,
                  {
                    id: createId('warning'),
                    kind: 'warning',
                    message: chatEvent.data.error.message ?? 'The assistant reported a warning.',
                  },
                ]);
                break;
            }
          },
          onComplete: () => {
            setStreamStatus('Ready for the next question');
          },
        },
      );

      setTimelineItems((current) =>
        current.map((item) =>
          item.id === assistantMessageId && item.kind === 'message'
            ? { ...item, pending: false }
            : item,
        ),
      );

      await refreshConversations(streamConversationId ?? selectedConversationId ?? activeConversationMeta?.id ?? undefined);
    } catch (streamError) {
      const streamMessage = streamError instanceof Error ? streamError.message : 'Chat request failed.';
      setError(streamMessage);
      setStreamStatus('Stream failed');
      setTimelineItems((current) =>
        current.map((item) =>
          item.id === assistantMessageId && item.kind === 'message'
            ? {
                ...item,
                text:
                  item.text.trim().length > 0
                    ? item.text
                    : 'I could not complete that response. Please try again.',
                pending: false,
              }
            : item,
        ),
      );
    } finally {
      streamingConversationIdRef.current = null;
      setPending(false);
      pendingRef.current = false;
    }
  };

  const handleNewChat = () => {
    stopVoiceRecognition({ abort: true });
    resetVoiceTranscriptSession();
    streamingConversationIdRef.current = null;
    setSelectedConversationId(null);
    setActiveConversationMeta(null);
    setTimelineItems([]);
    setExpandedToolActivityIds({});
    setExpandedReasoningIds({});
    setAppointmentFollowUpSubmittingRunIds({});
    setAudioGeneratingMessageIds({});
    setAutoPlayingMessageId(null);
    setAudioPlaybackRequestIds({});
    setError(null);
    setStreamStatus('Ready for a new conversation');
  };

  const handleSelectConversation = (conversation: ConversationSummary) => {
    if (pending) {
      return;
    }

    stopVoiceRecognition({ abort: true });
    resetVoiceTranscriptSession();
    streamingConversationIdRef.current = null;
    setSelectedConversationId(conversation.id);
    setActiveConversationMeta(conversation);
    setExpandedToolActivityIds({});
    setExpandedReasoningIds({});
    setAppointmentFollowUpSubmittingRunIds({});
    setAudioGeneratingMessageIds({});
    setAutoPlayingMessageId(null);
    setAudioPlaybackRequestIds({});
    setError(null);
    setStreamStatus('Loading conversation');
  };

  const handleRequestDeleteConversation = (
    event: MouseEvent<HTMLButtonElement>,
    conversation: ConversationSummary,
  ) => {
    event.stopPropagation();

    if (pending || deletingConversationIds[conversation.id]) {
      return;
    }

    setConversationPendingDelete(conversation);
    setError(null);
  };

  const handleCancelDeleteConversation = () => {
    if (conversationPendingDelete && deletingConversationIds[conversationPendingDelete.id]) {
      return;
    }

    setConversationPendingDelete(null);
  };

  const handleConfirmDeleteConversation = async () => {
    if (!conversationPendingDelete || deletingConversationIds[conversationPendingDelete.id]) {
      return;
    }

    const conversation = conversationPendingDelete;
    const deleteIndex = conversations.findIndex((candidate) => candidate.id === conversation.id);

    setDeletingConversationIds((current) => ({ ...current, [conversation.id]: true }));
    setError(null);

    try {
      await apiClient.deleteConversation(conversation.id);

      const remainingConversations = conversations.filter(
        (candidate) => candidate.id !== conversation.id,
      );
      setConversations(remainingConversations);
      setConversationPendingDelete(null);

      if (selectedConversationId === conversation.id) {
        const nextConversation =
          remainingConversations[Math.min(Math.max(deleteIndex, 0), remainingConversations.length - 1)] ??
          null;

        if (nextConversation) {
          handleSelectConversation(nextConversation);
        } else {
          handleNewChat();
        }
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Could not delete that conversation.',
      );
    } finally {
      setDeletingConversationIds((current) => {
        const next = { ...current };
        delete next[conversation.id];
        return next;
      });
    }
  };

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    await submitMessage(composer);
  };

  useEffect(() => {
    if (pending || !backendHealthy) {
      stopVoiceRecognition({ abort: true });
      resetVoiceTranscriptSession();
    }
  }, [backendHealthy, pending]);

  useEffect(
    () => () => {
      stopVoiceRecognition({ abort: true });
      resetVoiceTranscriptSession();
    },
    [],
  );

  const toggleToolActivity = (messageId: string) => {
    setExpandedToolActivityIds((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  };

  const toggleReasoning = (messageId: string, currentlyExpanded = false) => {
    setExpandedReasoningIds((current) => ({
      ...current,
      [messageId]: !currentlyExpanded,
    }));
  };

  const handleDeleteMessage = async (item: Extract<TimelineItem, { kind: 'message' }>) => {
    const conversationId = selectedConversationId ?? activeConversation?.id;

    if (!conversationId || item.pending || deletingMessageIds[item.id]) {
      return;
    }

    if (!isPersistedMessageId(item.id)) {
      setError('That message is still syncing. Please try again in a moment.');
      return;
    }

    setDeletingMessageIds((current) => ({ ...current, [item.id]: true }));
    setError(null);

    try {
      await apiClient.deleteMessage(conversationId, item.id);
      setTimelineItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setExpandedToolActivityIds((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setExpandedReasoningIds((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await refreshConversations(conversationId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete that message.');
    } finally {
      setDeletingMessageIds((current) => ({ ...current, [item.id]: false }));
    }
  };

  const handleRequestAppointment = async (input: {
    runId: string;
    contact: BookAppointmentContact;
    specialty?: string;
    reason?: string;
  }) => {
    const conversationId = selectedConversationId ?? activeConversation?.id;

    if (!conversationId || appointmentFollowUpSubmittingRunIds[input.runId]) {
      return;
    }

    setAppointmentFollowUpSubmittingRunIds((current) => ({
      ...current,
      [input.runId]: true,
    }));
    setError(null);

    try {
      const createdMessage = await apiClient.createAppointmentFollowUp(conversationId, {
        runId: input.runId,
        specialty: input.specialty,
        reason: input.reason,
        doctorName: input.contact.doctorName,
        phone: input.contact.phone,
      });

      if (createdMessage.role === 'assistant' || createdMessage.role === 'user') {
        const timelineMessage = createdMessage as ConversationMessage & {
          role: 'assistant' | 'user';
        };
        setTimelineItems((current) => [...current, conversationMessageToTimelineItem(timelineMessage)]);
      }
      await refreshConversations(conversationId);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not save the appointment follow-up request.',
      );
    } finally {
      setAppointmentFollowUpSubmittingRunIds((current) => ({
        ...current,
        [input.runId]: false,
      }));
    }
  };

  return (
    <main className="h-screen overflow-hidden bg-[linear-gradient(180deg,#eff4ff_0%,#f6f8ff_35%,#f7fbff_100%)] text-slate-900">
      <div className="mx-auto flex h-screen max-w-[1600px] gap-4 overflow-hidden px-3 py-3 sm:px-5 sm:py-5">
        <aside className="hidden h-full w-[310px] shrink-0 overflow-hidden rounded-[22px] border border-[#d6e0ff] bg-[linear-gradient(180deg,#e7eeff_0%,#f2f5ff_52%,#eef2ff_100%)] p-4 shadow-[0_24px_70px_rgba(76,97,183,0.16)] ring-1 ring-white/60 lg:flex lg:flex-col">
          <div className="mb-5 flex items-center justify-between gap-3 px-2">
            <div>
              <AppBrand className="text-xs font-semibold uppercase tracking-[0.26em] text-[#6880c7]" />
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                Conversations
              </h1>
            </div>
            <button
              type="button"
              onClick={handleNewChat}
              disabled={pending}
              aria-label="New chat"
              title="New chat"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#3867ff_0%,#5c83ff_100%)] text-white shadow-[0_14px_28px_rgba(56,103,255,0.22)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <PlusIcon />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {loadingConversations && (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-20 animate-pulse rounded-[16px] bg-white/80"
                  />
                ))}
              </div>
            )}

            {!loadingConversations &&
              conversations.map((conversation) => {
                const active = conversation.id === selectedConversationId;
                const deletingConversation = deletingConversationIds[conversation.id];

                return (
                  <div
                    key={conversation.id}
                    className={`group relative rounded-[14px] transition duration-200 ${
                      active
                        ? 'border border-[#cbd8ff] bg-white/80 shadow-sm'
                        : 'border border-transparent bg-transparent hover:bg-[#dfe7ff]/65'
                    } ${pending || deletingConversation ? 'opacity-60' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectConversation(conversation)}
                      disabled={pending || deletingConversation}
                      className="w-full rounded-[14px] px-3.5 py-2 pr-16 text-left disabled:cursor-not-allowed"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] transition ${
                              active
                                ? 'bg-[#eef3ff] text-[#3867ff]'
                                : 'bg-transparent text-[#6f80b3] group-hover:text-[#315fe8]'
                            }`}
                            aria-hidden="true"
                          >
                            <ConversationIcon />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold leading-5 text-slate-900">
                              {formatConversationCardTitle(conversation.title)}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full transition ${
                            active ? 'bg-[#3867ff]' : 'bg-transparent group-hover:bg-[#cfd9ff]'
                          }`}
                        />
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => handleRequestDeleteConversation(event, conversation)}
                      disabled={pending || deletingConversation}
                      aria-label={`Delete ${formatConversationCardTitle(conversation.title)}`}
                      title="Delete conversation"
                      className={`absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[10px] border border-rose-100 bg-white/95 text-rose-500 shadow-sm transition hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                        deletingConversation ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {deletingConversation ? (
                        <span
                          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-rose-200 border-t-rose-500"
                          aria-hidden="true"
                        />
                      ) : (
                        <TrashIcon />
                      )}
                    </button>
                  </div>
                );
              })}

            {!loadingConversations && conversations.length === 0 && (
              <div className="rounded-[16px] border border-dashed border-[#d2dcff] bg-white/65 px-4 py-5 text-sm text-slate-500">
                No saved conversations yet. Start a new chat to see it here.
              </div>
            )}
          </div>

          <div className="mt-4 rounded-[18px] border border-white/70 bg-white/90 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
                <p className="truncate text-xs text-slate-500">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                aria-label="Log out"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-[#d9e3ff] text-slate-500 transition hover:bg-[#f6f8ff] hover:text-slate-900"
              >
                <LogoutIcon />
              </button>
            </div>

            <div className="mt-4 rounded-[14px] bg-[#eef3ff] px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-[#4a66bd]">
                <span>Your Token Usage</span>
                <span>
                  {formatTokenCount(userUsage.totalTokens)} / {formatTokenCount(userUsageLimit)}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/80">
                <div
                  className="h-full rounded-full bg-[#3867ff] transition-all"
                  style={{ width: `${userUsagePercent}%` }}
                />
              </div>
            </div>
          </div>
        </aside>

        <section className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-white/70 bg-white/78 shadow-[0_28px_80px_rgba(76,97,183,0.12)] backdrop-blur">
          <header className="border-b border-slate-100/80 px-5 py-4 sm:px-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#eef3ff] text-[#3867ff]">
                  <ConversationIcon />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-2xl font-semibold tracking-tight text-slate-950">
                    {activeConversation?.title ?? 'Start a new health conversation'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {activeConversation
                      ? 'Ask follow-up questions, review tool activity, and continue where you left off.'
                      : 'Your next message will create a new thread and save it in the sidebar.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-[12px] bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                  {conversationTokenTotal.toLocaleString()} tokens
                </span>
                <label className="inline-flex items-center gap-2 rounded-[12px] bg-[#f7f9ff] px-3 py-1.5 text-xs font-semibold text-[#4d69c5]">
                  <input
                    type="checkbox"
                    checked={autoSpeakEnabled}
                    onChange={(event) => setAutoSpeakEnabled(event.target.checked)}
                    className="h-4 w-4 accent-[#3867ff]"
                  />
                  AI voice
                </label>
                <span className="rounded-[12px] bg-[#eef3ff] px-3 py-1.5 text-xs font-semibold text-[#4d69c5]">
                  {streamStatus}
                </span>
              </div>
            </div>
          </header>

          {bootError && (
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-800 sm:px-7">
              {bootError}
            </div>
          )}

          {error && (
            <div className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700 sm:px-7">
              {error}
            </div>
          )}

          {voiceError && !error && (
            <div className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700 sm:px-7">
              {voiceError}
            </div>
          )}

          <div ref={threadViewportRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-44 pt-6 sm:px-7">
            {loadingMessages ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className={`h-24 animate-pulse rounded-[18px] ${
                      index % 2 === 0 ? 'mr-auto max-w-xl bg-slate-100' : 'ml-auto max-w-md bg-[#dce6ff]'
                    }`}
                  />
                ))}
              </div>
            ) : timelineItems.length === 0 ? (
              <div className="mx-auto mt-14 max-w-3xl animate-fade-up text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#3867ff_0%,#7f9bff_100%)] text-white shadow-[0_16px_36px_rgba(56,103,255,0.2)]">
                  <NurseLogo className="h-9 w-9" />
                </div>
                <h3 className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">
                  Ask MediBuddy anything about your care
                </h3>
                <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-500">
                  Medication checks, symptom questions, appointment prep, and patient-context-aware
                  guidance all live here. Tool usage will appear inline as the assistant works.
                </p>
              </div>
            ) : (
              <div className="mx-auto max-w-4xl space-y-4">
                {timelineItems.map((item) => {
                  if (item.kind === 'warning') {
                    return (
                      <div
                        key={item.id}
                        className="animate-fade-up rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800"
                      >
                        {item.message}
                      </div>
                    );
                  }

                  const hasToolActivity = item.role === 'assistant' && (item.toolActivities?.length ?? 0) > 0;
                  const toolActivityExpanded = hasToolActivity
                    ? expandedToolActivityIds[item.id] === true
                    : false;
                  const toolActivityBusy =
                    hasToolActivity &&
                    (item.pending ||
                      (item.toolActivities ?? []).some((activity) => activity.status !== 'completed'));
                  const reasoningExpanded = item.reasoning
                    ? expandedReasoningIds[item.id] === true
                    : false;
                  return (
                    <div
                      key={item.id}
                      className={`animate-fade-up flex ${
                        item.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <div
                        className={`group/message-row ${
                          item.role === 'user' ? 'max-w-[min(78%,560px)]' : 'max-w-[85%]'
                        }`}
                      >
                        <article
                          className={`relative rounded-[20px] px-5 py-4 shadow-sm ${
                            item.role === 'user'
                              ? 'border border-[#3564ff] bg-[#4973ff] text-white shadow-[0_16px_32px_rgba(56,103,255,0.2)]'
                              : 'border border-slate-100 bg-white text-slate-800'
                          }`}
                        >
                          {item.role === 'assistant' && (
                            <AppBrand
                              className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6f80b3]"
                              iconClassName="h-3.5 w-3.5"
                            />
                          )}
                          {item.role === 'assistant' ? (
                            item.text ? (
                              <MarkdownMessage text={item.text} />
                            ) : (
                              <p
                                key={getLatestReasoningText(item.reasoning) || 'thinking'}
                                className="animate-reasoning-update mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-400"
                              >
                                {item.pending ? getLatestReasoningText(item.reasoning) || 'Thinking...' : ''}
                              </p>
                            )
                          ) : (
                            <p className="whitespace-pre-wrap text-[15px] leading-7 text-white/95">
                              {item.text}
                            </p>
                          )}
                          {item.pending && (
                            <div className="mt-4 flex items-center gap-2">
                              <span className="h-2 w-2 animate-bounce rounded-full bg-[#8ca6ff]" />
                              <span className="h-2 w-2 animate-bounce rounded-full bg-[#8ca6ff] [animation-delay:120ms]" />
                              <span className="h-2 w-2 animate-bounce rounded-full bg-[#8ca6ff] [animation-delay:240ms]" />
                            </div>
                          )}
                        </article>

                        {item.role === 'assistant' && (
                          <MessageMetadataRow
                            createdAt={item.createdAt}
                            metadata={item.metadata}
                            hasReasoning={!item.pending && Boolean(item.reasoning)}
                            reasoningExpanded={reasoningExpanded}
                            onToggleReasoning={() => toggleReasoning(item.id, reasoningExpanded)}
                            hasToolActivity={hasToolActivity}
                            toolActivityExpanded={toolActivityExpanded}
                            toolActivityBusy={toolActivityBusy}
                            onToggleToolActivity={() => toggleToolActivity(item.id)}
                            hasAudioAction={!item.pending && isPersistedMessageId(item.id)}
                            audioActionBusy={audioGeneratingMessageIds[item.id]}
                            audioActionLabel={item.audio ? 'Replay voice' : 'Play voice'}
                            onAudioAction={() => handlePlayMessageAudio(item)}
                            hasDeleteAction={!item.pending && isPersistedMessageId(item.id)}
                            deleteActionBusy={deletingMessageIds[item.id]}
                            onDeleteAction={() => void handleDeleteMessage(item)}
                          />
                        )}

                        {item.role === 'user' && !item.pending && isPersistedMessageId(item.id) && (
                          <div className="mt-2 flex justify-end text-[11px] font-medium">
                            <button
                              type="button"
                              onClick={() => void handleDeleteMessage(item)}
                              disabled={deletingMessageIds[item.id]}
                              className={`text-rose-500 underline underline-offset-2 transition hover:text-rose-600 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-50 ${
                                deletingMessageIds[item.id]
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover/message-row:opacity-100'
                              }`}
                            >
                              {deletingMessageIds[item.id] ? 'Deleting' : 'Delete'}
                            </button>
                          </div>
                        )}

                        {item.role === 'assistant' && audioGeneratingMessageIds[item.id] && (
                          <div className="mt-3 rounded-[14px] border border-[#dfe7ff] bg-[#f8faff] px-3 py-3 text-xs font-semibold text-[#5d75c9]">
                            Preparing AI voice
                          </div>
                        )}

                        {item.role === 'assistant' && item.audio && !audioGeneratingMessageIds[item.id] && (
                          <MessageAudioPlayer
                            audio={item.audio}
                            playRequestId={
                              autoPlayingMessageId === item.id
                                ? audioPlaybackRequestIds[item.id]
                                : undefined
                            }
                          />
                        )}

                        {item.role === 'assistant' && !item.pending && item.reasoning && reasoningExpanded && (
                          <ReasoningPanel reasoning={item.reasoning} />
                        )}

                        {hasToolActivity && toolActivityExpanded && (
                          <ToolActivityPanel
                            activities={item.toolActivities ?? []}
                            parentRunId={item.runId}
                            requestedRunIds={requestedAppointmentRunIds}
                            requestingRunIds={appointmentFollowUpSubmittingRunIds}
                            onRequestAppointment={handleRequestAppointment}
                          />
                        )}

                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(248,250,255,0.92)_50%,rgba(248,250,255,1)_100%)]" />

          <div className="pointer-events-none absolute bottom-5 left-4 right-4 sm:left-7 sm:right-7">
            <form
              onSubmit={handleSend}
              className="pointer-events-auto mx-auto max-w-4xl rounded-[18px] border border-[#e1e6ff] bg-white/92 p-3 shadow-[0_18px_44px_rgba(76,97,183,0.14)] backdrop-blur"
            >
              <div className="flex items-end gap-3">
                <button
                  type="button"
                  onClick={handleVoiceButtonClick}
                  disabled={pending || !backendHealthy}
                  className={`relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-visible rounded-[14px] transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    voiceListening
                      ? 'bg-rose-50 text-rose-600 shadow-[0_0_0_4px_rgba(244,63,94,0.1)] hover:bg-rose-100'
                      : 'bg-[#f2f5ff] text-[#4d69c5] hover:bg-[#e7edff]'
                  }`}
                  aria-label={voiceListening ? 'Stop voice input' : 'Voice input'}
                  aria-pressed={voiceListening}
                  title={voiceSupported ? 'Voice input' : VOICE_UNSUPPORTED_MESSAGE}
                >
                  {voiceListening && (
                    <>
                      <span className="absolute inset-0 animate-ping rounded-[14px] bg-rose-300/35" />
                      <span className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-rose-500 ring-2 ring-white" />
                    </>
                  )}
                  <span className="relative">
                    <MicIcon />
                  </span>
                </button>

                <textarea
                  ref={composerRef}
                  value={composer}
                  onChange={(event) => handleComposerChange(event.target.value)}
                  placeholder="Message your care assistant about medications, symptoms, or your next appointment..."
                  rows={1}
                  disabled={pending || !backendHealthy}
                  className="max-h-[200px] min-h-[52px] flex-1 resize-none bg-transparent px-1 py-3 text-sm leading-7 text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                />

                {voiceListening && (
                  <button
                    type="button"
                    onClick={handleVoiceCancel}
                    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-rose-100 bg-white text-rose-500 shadow-sm transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Cancel voice input"
                    title="Cancel voice input"
                  >
                    <XIcon />
                  </button>
                )}

                {composer.trim().length > 0 && (
                  <button
                    type="submit"
                    disabled={pending || !backendHealthy}
                    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#3867ff_0%,#6287ff_100%)] text-white shadow-[0_14px_32px_rgba(56,103,255,0.22)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Send message"
                  >
                    <SendIcon />
                  </button>
                )}
              </div>
            </form>
          </div>
        </section>
      </div>

      {conversationPendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-conversation-title"
        >
          <div className="w-full max-w-sm rounded-[18px] border border-white/70 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
            <h2
              id="delete-conversation-title"
              className="text-base font-semibold text-slate-950"
            >
              Delete conversation?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This will remove "{formatConversationCardTitle(conversationPendingDelete.title)}"
              from your conversation history.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelDeleteConversation}
                disabled={deletingConversationIds[conversationPendingDelete.id]}
                className="rounded-[12px] border border-[#d9e3ff] px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-[#f6f8ff] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteConversation()}
                disabled={deletingConversationIds[conversationPendingDelete.id]}
                className="rounded-[12px] bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingConversationIds[conversationPendingDelete.id] ? 'Deleting' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
