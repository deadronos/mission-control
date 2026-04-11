import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskChatTab } from '@/components/TaskChatTab';
import { MentionInput } from '@/components/chat/MentionInput';
import { TaskImages } from '@/components/TaskImages';
import { SessionsList } from '@/components/SessionsList';

vi.mock('next/image', () => ({
  default: (props: any) => <img {...props} />,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const mocks = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  confirmMock: vi.fn(),
}));

function okResponse<T>(body: T, status = 200) {
  return {
    ok: true,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function errorResponse<T>(body: T, status = 500) {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  mocks.fetchMock.mockReset();
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = mocks.fetchMock as typeof fetch;
  mocks.confirmMock.mockReset();
  vi.spyOn(window, 'confirm').mockImplementation(mocks.confirmMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TaskChatTab', () => {
  it('loads notes, shows the waiting bubble, and sends a new message', async () => {
    const notes = [
      {
        id: 'note-1',
        role: 'user',
        content: 'Hello agent',
        status: 'delivered',
        created_at: new Date().toISOString(),
      },
    ];

    mocks.fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/chat') && method === 'GET') {
        return okResponse(notes);
      }
      if (url.endsWith('/read') && method === 'POST') {
        return okResponse({ success: true });
      }
      if (url.endsWith('/chat/agents') && method === 'GET') {
        return okResponse([]);
      }
      if (url.endsWith('/chat') && method === 'POST') {
        notes.push({
          id: 'note-2',
          role: 'user',
          content: 'Please help with the feature',
          status: 'delivered',
          created_at: new Date().toISOString(),
        });
        return okResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const { container } = render(<TaskChatTab taskId="task-chat" />);

    expect(await screen.findByText('Hello agent')).toBeInTheDocument();
    expect(container.querySelectorAll('[style*="animation-delay"]').length).toBe(3);

    fireEvent.change(screen.getByPlaceholderText('Message the agent... (@ to mention, / for commands)'), {
      target: { value: 'Please help with the feature' },
    });
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/tasks/task-chat/chat',
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(screen.getByText('Please help with the feature')).toBeInTheDocument();
  });
});

describe('MentionInput', () => {
  it('inserts a mention from the dropdown', async () => {
    mocks.fetchMock.mockResolvedValueOnce(okResponse([
      {
        id: 'agent-1',
        name: 'Alice',
        avatar_emoji: '🧪',
        role: 'Testing lead',
        status: 'standby',
        is_assigned: false,
        is_convoy_member: false,
      },
    ]));

    function Wrapper() {
      const [value, setValue] = useState('');
      return (
        <MentionInput
          taskId="task-mention"
          value={value}
          onChange={setValue}
          onSend={vi.fn()}
          sending={false}
          placeholder="Type a message"
          onSlashCommand={vi.fn()}
        />
      );
    }

    render(<Wrapper />);

    const textarea = await screen.findByPlaceholderText('Type a message');
    fireEvent.change(textarea, {
      target: { value: '@ali', selectionStart: 4 },
    });

    const aliceButton = await screen.findByRole('button', { name: /Alice/i });
    fireEvent.click(aliceButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type a message')).toHaveValue('@Alice ');
    });
  });

  it('fires slash commands and sends on Enter', async () => {
    mocks.fetchMock.mockResolvedValueOnce(okResponse([]));
    const onSend = vi.fn();
    const onSlashCommand = vi.fn();

    function Wrapper() {
      const [value, setValue] = useState('');
      return (
        <MentionInput
          taskId="task-slash"
          value={value}
          onChange={setValue}
          onSend={onSend}
          sending={false}
          placeholder="Type a message"
          onSlashCommand={onSlashCommand}
        />
      );
    }

    render(<Wrapper />);

    const textarea = await screen.findByPlaceholderText('Type a message');
    fireEvent.change(textarea, {
      target: { value: '/plan' },
    });

    expect(onSlashCommand).toHaveBeenCalledWith('/plan');

    fireEvent.change(textarea, {
      target: { value: 'Ping the agent' },
    });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe('TaskImages', () => {
  it('uploads an image and deletes it again', async () => {
    const image = {
      filename: 'shot.png',
      original_name: 'shot.png',
    };

    mocks.fetchMock
      .mockResolvedValueOnce(okResponse({ images: [] }))
      .mockResolvedValueOnce(okResponse({ image }))
      .mockResolvedValueOnce(okResponse({}));

    render(<TaskImages taskId="task-images" />);

    expect(await screen.findByText(/No images attached/i)).toBeInTheDocument();

    const fileInput = screen.getByLabelText(/Add Image/i);
    const file = new File(['fake image bytes'], 'shot.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByAltText('shot.png')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByText(/No images attached/i)).toBeInTheDocument();
    });
  });
});

describe('SessionsList', () => {
  it('shows the empty state when there are no sessions', async () => {
    mocks.fetchMock.mockResolvedValueOnce(okResponse([]));

    render(<SessionsList taskId="task-sessions-empty" />);

    expect(await screen.findByText(/No sub-agent sessions yet/i)).toBeInTheDocument();
  });

  it('marks sessions complete and deletes them', async () => {
    const sessions = [
      {
        id: 'session-row-1',
        agent_id: 'agent-1',
        openclaw_session_id: 'sess-1',
        channel: 'planning',
        status: 'active',
        session_type: 'subagent',
        task_id: 'task-sessions',
        ended_at: null,
        created_at: '2026-04-11T10:00:00.000Z',
        updated_at: '2026-04-11T10:00:00.000Z',
        agent_name: 'Scout',
        agent_avatar_emoji: '🛰️',
      },
      {
        id: 'session-row-2',
        agent_id: 'agent-2',
        openclaw_session_id: 'sess-2',
        channel: 'review',
        status: 'completed',
        session_type: 'subagent',
        task_id: 'task-sessions',
        ended_at: '2026-04-11T10:30:00.000Z',
        created_at: '2026-04-11T10:00:00.000Z',
        updated_at: '2026-04-11T10:30:00.000Z',
        agent_name: 'Reviewer',
        agent_avatar_emoji: '🔍',
      },
    ];

    mocks.fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/subagent') && method === 'GET') {
        return okResponse(sessions);
      }
      if (url === '/api/openclaw/sessions/sess-1' && method === 'PATCH') {
        sessions[0] = { ...sessions[0], status: 'completed', ended_at: new Date().toISOString() };
        return okResponse({ success: true });
      }
      if (url.endsWith('/subagent') && method === 'GET' && sessions[0].status === 'completed') {
        return okResponse(sessions);
      }
      if (url === '/api/openclaw/sessions/sess-2' && method === 'DELETE') {
        sessions.splice(1, 1);
        return okResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    mocks.confirmMock.mockReturnValue(true);

    render(<SessionsList taskId="task-sessions" />);

    expect(await screen.findByText('Scout')).toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Mark as complete'));

    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/openclaw/sessions/sess-1',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    fireEvent.click(screen.getAllByTitle('Delete session')[1]);

    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/openclaw/sessions/sess-2',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
