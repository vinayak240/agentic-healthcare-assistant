import { API_BASE_URL } from '../config';
import type {
  ApiErrorPayload,
  ChatRequest,
  ChatStreamEvent,
  ConversationListResponse,
  MessageAudioMetadata,
  ConversationMessage,
  ConversationMessagesResponse,
  ConversationToolEventsResponse,
  CreateAppointmentFollowUpInput,
  CreateUserInput,
  DeleteConversationResponse,
  DeleteMessageResponse,
  HealthResponse,
  LoginUserInput,
  User,
  UserUsageResponse,
} from './types';

function joinUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload;

    if (Array.isArray(payload.message)) {
      return payload.message.join(', ');
    }

    return payload.message ?? payload.error ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(joinUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as T;
}

export const apiClient = {
  getHealth() {
    return requestJson<HealthResponse>('/system/health');
  },

  getUserUsage(userId: string) {
    return requestJson<UserUsageResponse>(`/usage/user/${encodeURIComponent(userId)}`);
  },

  getUser(userId: string) {
    return requestJson<User>(`/users/${userId}`);
  },

  listUsers() {
    return requestJson<{ items: User[] }>('/users');
  },

  createUser(input: CreateUserInput) {
    return requestJson<User>('/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  loginUser(input: LoginUserInput) {
    return requestJson<User>('/users/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listConversations(userId: string) {
    return requestJson<ConversationListResponse>(
      `/conversations?userId=${encodeURIComponent(userId)}`,
    );
  },

  listMessages(conversationId: string) {
    return requestJson<ConversationMessagesResponse>(`/conversations/${conversationId}/messages`);
  },

  listConversationToolEvents(conversationId: string, runId?: string) {
    const params = new URLSearchParams();

    if (runId) {
      params.set('runId', runId);
    }

    const query = params.toString();

    return requestJson<ConversationToolEventsResponse>(
      `/conversations/${conversationId}/tool-events${query ? `?${query}` : ''}`,
    );
  },

  createAppointmentFollowUp(conversationId: string, input: CreateAppointmentFollowUpInput) {
    return requestJson<ConversationMessage>(`/conversations/${conversationId}/appointment-follow-up`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  deleteMessage(conversationId: string, messageId: string) {
    return requestJson<DeleteMessageResponse>(
      `/conversations/${conversationId}/messages/${messageId}`,
      {
        method: 'DELETE',
      },
    );
  },

  deleteConversation(conversationId: string) {
    return requestJson<DeleteConversationResponse>(`/conversations/${conversationId}`, {
      method: 'DELETE',
    });
  },

  createMessageAudio(conversationId: string, messageId: string) {
    return requestJson<MessageAudioMetadata>(
      `/conversations/${conversationId}/messages/${messageId}/audio`,
      {
        method: 'POST',
      },
    );
  },

  async streamChat(
    input: ChatRequest,
    handlers: {
      onEvent: (event: ChatStreamEvent) => void;
      onComplete?: () => void;
    },
  ) {
    const response = await fetch(joinUrl('/chat/stream'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await parseError(response));
    }

    if (!response.body) {
      throw new Error('Streaming is not available in this browser.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        const lines = chunk
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);

        for (const line of lines) {
          if (!line.startsWith('data:')) {
            continue;
          }

          const payload = line.slice(5).trim();

          if (!payload) {
            continue;
          }

          try {
            handlers.onEvent(JSON.parse(payload) as ChatStreamEvent);
          } catch {
            throw new Error('Received malformed stream data from the server.');
          }
        }
      }
    }

    if (buffer.trim().length > 0) {
      throw new Error('The chat stream ended unexpectedly.');
    }

    handlers.onComplete?.();
  },
};
