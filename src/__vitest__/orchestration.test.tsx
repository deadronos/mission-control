import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getMissionControlUrl: () => 'http://mission.test',
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  completeSubAgentSession,
  getDeliverables,
  logActivity,
  logDeliverable,
  registerSubAgentSession,
  verifyTaskHasDeliverables,
} from '@/lib/orchestration';

beforeEach(() => {
  mocks.fetchMock.mockReset();
  mocks.loggerInfo.mockReset();
  mocks.loggerError.mockReset();
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = mocks.fetchMock as typeof fetch;
});

describe('orchestration helpers', () => {
  it('posts task activity payloads to the task activity endpoint', async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => '',
    });

    await logActivity({
      taskId: 'task-1',
      activityType: 'completed',
      message: 'Task finished',
      agentId: 'agent-1',
      metadata: { step: 'done' },
    });

    expect(mocks.fetchMock).toHaveBeenCalledWith(
      'http://mission.test/api/tasks/task-1/activities',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const [, requestInit] = mocks.fetchMock.mock.calls[0];
    expect(JSON.parse((requestInit as RequestInit).body as string)).toEqual({
      activity_type: 'completed',
      message: 'Task finished',
      agent_id: 'agent-1',
      metadata: { step: 'done' },
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith('✓ Activity logged: Task finished');
  });

  it('logs failed deliverable writes with endpoint context', async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'database unavailable',
    });

    await logDeliverable({
      taskId: 'task-2',
      deliverableType: 'file',
      title: 'index.html',
      path: '/tmp/index.html',
    });

    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-2',
        endpoint: 'http://mission.test/api/tasks/task-2/deliverables',
        status: 500,
        response: 'database unavailable',
        deliverableType: 'file',
        title: 'index.html',
      }),
      'Failed to log deliverable'
    );
  });

  it('registers sub-agent sessions with the expected payload', async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => '',
    });

    await registerSubAgentSession({
      taskId: 'task-3',
      sessionId: 'session-123',
      agentName: 'Builder',
    });

    const [url, requestInit] = mocks.fetchMock.mock.calls[0];
    expect(url).toBe('http://mission.test/api/tasks/task-3/subagent');
    expect(JSON.parse((requestInit as RequestInit).body as string)).toEqual({
      openclaw_session_id: 'session-123',
      agent_name: 'Builder',
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith('✓ Sub-agent session registered: session-123');
  });

  it('returns an empty list when deliverables cannot be fetched', async () => {
    mocks.fetchMock.mockRejectedValue(new Error('network down'));

    await expect(getDeliverables('task-4')).resolves.toEqual([]);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-4',
        endpoint: 'http://mission.test/api/tasks/task-4/deliverables',
        error: expect.any(Error),
      }),
      'Error fetching deliverables'
    );
    await expect(verifyTaskHasDeliverables('task-4')).resolves.toBe(false);
  });

  it('marks a sub-agent session complete and includes the summary in logs', async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    await completeSubAgentSession('session-456', 'Wrapped up');

    const [url, requestInit] = mocks.fetchMock.mock.calls[0];
    expect(url).toBe('http://mission.test/api/openclaw/sessions/session-456');
    const payload = JSON.parse((requestInit as RequestInit).body as string);
    expect(payload.status).toBe('completed');
    expect(typeof payload.ended_at).toBe('string');
    expect(mocks.loggerInfo).toHaveBeenCalledWith('✓ Sub-agent session completed: session-456 (Wrapped up)');
  });
});
