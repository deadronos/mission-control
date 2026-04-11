import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { queryOne, run } from '@/lib/db';
import { randomUUID } from 'crypto';

const {
  broadcastMock,
  buildCheckpointContextMock,
  endTaskSessionMock,
  getMissionControlUrlMock,
  getApiTokenMock,
  loggerMock,
} = vi.hoisted(() => ({
  broadcastMock: vi.fn(),
  buildCheckpointContextMock: vi.fn<(taskId: string) => string | null>(() => null),
  endTaskSessionMock: vi.fn(),
  getMissionControlUrlMock: vi.fn(() => 'http://mission.local'),
  getApiTokenMock: vi.fn(() => undefined),
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const fetchMock = vi.fn();

vi.mock('@/lib/events', () => ({
  broadcast: broadcastMock,
}));

vi.mock('@/lib/checkpoint', () => ({
  buildCheckpointContext: buildCheckpointContextMock,
}));

vi.mock('@/lib/openclaw/task-session-registry', () => ({
  endTaskSession: endTaskSessionMock,
}));

vi.mock('@/lib/config', () => ({
  getMissionControlUrl: getMissionControlUrlMock,
}));

vi.mock('@/lib/runtime-compat', () => ({
  getApiToken: getApiTokenMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMock,
}));

function insertAgent(id: string, status: 'standby' | 'working' | 'offline' = 'working') {
  run(
    `INSERT INTO agents (id, name, role, workspace_id, status)
     VALUES (?, ?, 'builder', 'default', ?)`,
    [id, id, status]
  );
}

function insertTask(
  id: string,
  assignedAgentId: string | null,
  status: string = 'in_progress',
  updatedAt: string = new Date().toISOString(),
  planningComplete = 0
) {
  run(
    `INSERT INTO tasks (
       id, title, description, status, priority, assigned_agent_id,
       workspace_id, business_id, planning_complete, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'normal', ?, 'default', 'default', ?, ?, ?)`,
    [id, id, `${id} description`, status, assignedAgentId, planningComplete, updatedAt, updatedAt]
  );
}

function insertSession(id: string, agentId: string, taskId: string) {
  const now = new Date().toISOString();
  run(
    `INSERT INTO openclaw_sessions (
       id, agent_id, openclaw_session_id, channel, status, session_type, task_id, created_at, updated_at
     ) VALUES (?, ?, ?, 'mission', 'active', 'persistent', ?, ?, ?)`,
    [id, agentId, `${id}-session`, taskId, now, now]
  );
}

function insertActivity(taskId: string, createdAt: string, message = 'Real task activity') {
  run(
    `INSERT INTO task_activities (id, task_id, activity_type, message, created_at)
     VALUES (?, ?, 'status_changed', ?, ?)`,
    [randomUUID(), taskId, message, createdAt]
  );
}

function insertHealth(agentId: string, taskId: string | null, healthState = 'working', consecutiveStallChecks = 0) {
  run(
    `INSERT INTO agent_health (
       id, agent_id, task_id, health_state, consecutive_stall_checks, updated_at
     ) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [`health-${agentId}`, agentId, taskId, healthState, consecutiveStallChecks]
  );
}

function cleanupRows() {
  run(`DELETE FROM task_activities WHERE task_id LIKE 'agent-health-%'`);
  run(`DELETE FROM openclaw_sessions WHERE agent_id LIKE 'agent-health-%'`);
  run(`DELETE FROM agent_health WHERE agent_id LIKE 'agent-health-%'`);
  run(`DELETE FROM tasks WHERE id LIKE 'agent-health-%'`);
  run(`DELETE FROM agents WHERE id LIKE 'agent-health-%'`);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, text: async () => '' });
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;
  broadcastMock.mockClear();
  buildCheckpointContextMock.mockClear();
  endTaskSessionMock.mockClear();
  getMissionControlUrlMock.mockClear();
  getApiTokenMock.mockClear();
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
});

afterEach(() => {
  cleanupRows();
});

describe('agent-health', () => {
  test('classifies offline, idle, zombie, working, stalled, and stuck agents', async () => {
    const { checkAgentHealth } = await import('@/lib/agent-health');

    expect(checkAgentHealth('agent-health-missing')).toBe('offline');

    insertAgent('agent-health-offline', 'offline');
    expect(checkAgentHealth('agent-health-offline')).toBe('offline');

    insertAgent('agent-health-idle', 'working');
    expect(checkAgentHealth('agent-health-idle')).toBe('idle');

    insertAgent('agent-health-active', 'working');
    insertTask('agent-health-task', 'agent-health-active', 'in_progress');
    expect(checkAgentHealth('agent-health-active')).toBe('zombie');

    insertSession('agent-health-session', 'agent-health-active', 'agent-health-task');
    insertActivity('agent-health-task', new Date().toISOString());
    expect(checkAgentHealth('agent-health-active')).toBe('working');

    run(
      'UPDATE task_activities SET created_at = ? WHERE task_id = ?',
      [new Date(Date.now() - 10 * 60_000).toISOString(), 'agent-health-task']
    );
    expect(checkAgentHealth('agent-health-active')).toBe('stalled');

    run(
      'UPDATE task_activities SET created_at = ? WHERE task_id = ?',
      [new Date(Date.now() - 20 * 60_000).toISOString(), 'agent-health-task']
    );
    expect(checkAgentHealth('agent-health-active')).toBe('stuck');
  });

  test('runHealthCheckCycle updates health, auto-dispatches stale assigned work, and records idle agents', async () => {
    const { runHealthCheckCycle, getAgentHealth } = await import('@/lib/agent-health');

    insertAgent('agent-health-cycle', 'working');
    insertTask('agent-health-cycle-task', 'agent-health-cycle', 'in_progress');
    insertSession('agent-health-cycle-session', 'agent-health-cycle', 'agent-health-cycle-task');
    insertActivity(
      'agent-health-cycle-task',
      new Date(Date.now() - 10 * 60_000).toISOString()
    );
    insertHealth('agent-health-cycle', 'agent-health-cycle-task', 'working', 1);

    insertAgent('agent-health-orphan', 'working');
    insertTask(
      'agent-health-orphan-task',
      'agent-health-orphan',
      'assigned',
      new Date(Date.now() - 10 * 60_000).toISOString(),
      1
    );

    insertAgent('agent-health-standby', 'standby');

    const results = await runHealthCheckCycle();

    expect(results.map((row) => row.agent_id)).toEqual(expect.arrayContaining(['agent-health-cycle', 'agent-health-orphan']));

    const cycleHealth = getAgentHealth('agent-health-cycle');
    expect(cycleHealth?.health_state).toBe('stalled');
    expect(cycleHealth?.consecutive_stall_checks).toBe(2);

    const standbyHealth = getAgentHealth('agent-health-standby');
    expect(standbyHealth?.health_state).toBe('idle');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mission.local/api/tasks/agent-health-orphan-task/dispatch',
      expect.objectContaining({ method: 'POST' })
    );

    const orphanActivity = queryOne<{ message: string }>(
      'SELECT message FROM task_activities WHERE task_id = ? AND message LIKE ?',
      ['agent-health-orphan-task', 'Auto-dispatched by health sweeper%']
    );
    expect(orphanActivity?.message).toContain('Auto-dispatched by health sweeper');
  });

  test('nudgeAgent appends checkpoint context and resets a stuck task', async () => {
    const { nudgeAgent, getAgentHealth } = await import('@/lib/agent-health');

    buildCheckpointContextMock.mockReturnValue('\n[checkpoint]');

    insertAgent('agent-health-nudge', 'working');
    insertTask('agent-health-nudge-task', 'agent-health-nudge', 'in_progress');
    insertSession('agent-health-nudge-session', 'agent-health-nudge', 'agent-health-nudge-task');
    insertHealth('agent-health-nudge', 'agent-health-nudge-task', 'stuck', 3);

    const result = await nudgeAgent('agent-health-nudge');

    expect(result).toEqual({ success: true });
    expect(endTaskSessionMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mission.local/api/tasks/agent-health-nudge-task/dispatch',
      expect.objectContaining({ method: 'POST' })
    );

    const task = queryOne<{ status: string; description: string | null; planning_dispatch_error: string | null }>(
      'SELECT status, description, planning_dispatch_error FROM tasks WHERE id = ?',
      ['agent-health-nudge-task']
    );
    expect(task?.status).toBe('assigned');
    expect(task?.description).toContain('[checkpoint]');
    expect(task?.planning_dispatch_error).toBeNull();

    const health = getAgentHealth('agent-health-nudge');
    expect(health?.health_state).toBe('working');
    expect(health?.consecutive_stall_checks).toBe(0);
  });

  test('nudgeAgent reports dispatch failures and no-task cases', async () => {
    const { nudgeAgent } = await import('@/lib/agent-health');

    const missing = await nudgeAgent('agent-health-missing');
    expect(missing).toEqual({ success: false, error: 'No active task for this agent' });

    insertAgent('agent-health-fail', 'working');
    insertTask('agent-health-fail-task', 'agent-health-fail', 'in_progress');
    insertSession('agent-health-fail-session', 'agent-health-fail', 'agent-health-fail-task');
    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: async () => 'gateway refused',
    });

    const failed = await nudgeAgent('agent-health-fail');
    expect(failed.success).toBe(false);
    expect(failed.error).toContain('Dispatch failed: gateway refused');
  });
});
