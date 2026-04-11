import { afterEach, describe, expect, test, vi } from 'vitest';

const { infoMock, errorMock } = vi.hoisted(() => ({
  infoMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: infoMock,
    error: errorMock,
    warn: vi.fn(),
  },
}));

describe('auto-dispatch utilities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shouldTriggerAutoDispatch only fires on the transition into in_progress with an agent assigned', async () => {
    const { shouldTriggerAutoDispatch } = await import('@/lib/auto-dispatch');

    expect(shouldTriggerAutoDispatch(undefined, 'in_progress', 'agent-1')).toBe(true);
    expect(shouldTriggerAutoDispatch('inbox', 'in_progress', 'agent-1')).toBe(true);
    expect(shouldTriggerAutoDispatch('in_progress', 'in_progress', 'agent-1')).toBe(false);
    expect(shouldTriggerAutoDispatch('assigned', 'review', 'agent-1')).toBe(false);
    expect(shouldTriggerAutoDispatch('assigned', 'in_progress', null)).toBe(false);
  });

  test('triggerAutoDispatch fails fast when there is no agent', async () => {
    const { triggerAutoDispatch } = await import('@/lib/auto-dispatch');

    const result = await triggerAutoDispatch({
      taskId: 'task-1',
      taskTitle: 'Task 1',
      agentId: null,
      agentName: 'Builder',
    });

    expect(result).toEqual({ success: false, error: 'No agent ID provided for dispatch' });
  });

  test('triggerAutoDispatch reports success and logs the dispatch', async () => {
    const { triggerAutoDispatch } = await import('@/lib/auto-dispatch');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const result = await triggerAutoDispatch({
      taskId: 'task-1',
      taskTitle: 'Task 1',
      agentId: 'agent-1',
      agentName: 'Builder',
      workspaceId: 'default',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1/dispatch', { method: 'POST' });
    expect(result).toEqual({ success: true });
    expect(infoMock).toHaveBeenCalled();
  });

  test('triggerAutoDispatch surfaces API errors and network failures', async () => {
    const { triggerAutoDispatch } = await import('@/lib/auto-dispatch');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'dispatch failed' }),
    }));
    await expect(
      triggerAutoDispatch({
        taskId: 'task-1',
        taskTitle: 'Task 1',
        agentId: 'agent-1',
        agentName: 'Builder',
      })
    ).resolves.toEqual({ success: false, error: 'dispatch failed' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(
      triggerAutoDispatch({
        taskId: 'task-1',
        taskTitle: 'Task 1',
        agentId: 'agent-1',
        agentName: 'Builder',
      })
    ).resolves.toEqual({ success: false, error: 'network down' });
  });
});
