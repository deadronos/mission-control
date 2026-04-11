import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { AgentLiveTab } from '@/components/AgentLiveTab';

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  onopen: null | (() => void) = null;
  onmessage: null | ((event: { data: string }) => void) = null;
  onerror: null | (() => void) = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  error() {
    this.onerror?.();
  }
}

const originalEventSource = globalThis.EventSource;

beforeEach(() => {
  MockEventSource.instances = [];
  (globalThis as typeof globalThis & { EventSource: typeof EventSource }).EventSource = MockEventSource as unknown as typeof EventSource;
});

afterEach(() => {
  cleanup();
  (globalThis as typeof globalThis & { EventSource: typeof EventSource }).EventSource = originalEventSource;
  vi.restoreAllMocks();
});

describe('AgentLiveTab', () => {
  it('shows the no-session state', async () => {
    render(<AgentLiveTab taskId="task-live-no-session" />);

    const es = MockEventSource.instances[0];
    expect(es.url).toBe('/api/tasks/task-live-no-session/agent-stream');

    act(() => {
      es.emit({ type: 'no_session' });
    });

    expect(await screen.findByText(/No active agent session/i)).toBeInTheDocument();
    expect(screen.getByText(/Dispatch the task to start streaming agent activity/i)).toBeInTheDocument();
  });

  it('renders live streams, completed messages, and disconnect status', async () => {
    render(<AgentLiveTab taskId="task-live-stream" />);

    const es = MockEventSource.instances[0];
    expect(es.url).toBe('/api/tasks/task-live-stream/agent-stream');

    act(() => {
      es.emit({ type: 'streaming' });
    });

    await waitFor(() => {
      expect(screen.getByText('Live')).toBeInTheDocument();
    });

    act(() => {
      es.emit({ type: 'agent_stream', stream: 'thinking', data: 'Thinking…' });
    });
    expect(await screen.findByText('Thinking…')).toBeInTheDocument();

    act(() => {
      es.emit({
        type: 'message',
        index: 1,
        role: 'assistant',
        content: 'All done.',
        timestamp: '2026-04-11T10:00:00.000Z',
      });
    });

    expect(await screen.findByText('All done.')).toBeInTheDocument();
    expect(screen.getByText(/1 messages/i)).toBeInTheDocument();

    act(() => {
      es.emit({ type: 'session_ended' });
    });
    expect(screen.getAllByText(/Session ended/i).length).toBeGreaterThan(0);

    act(() => {
      es.error();
    });

    await waitFor(() => {
      expect(screen.getByText(/Disconnected — reconnecting/i)).toBeInTheDocument();
    });
  });
});
