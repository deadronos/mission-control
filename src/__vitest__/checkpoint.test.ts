import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { queryOne, run } from '@/lib/db';

const { broadcastMock } = vi.hoisted(() => ({ broadcastMock: vi.fn() }));

vi.mock('@/lib/events', () => ({
  broadcast: broadcastMock,
}));

describe('checkpoint utilities', () => {
  const taskId = 'checkpoint-task-1';
  const agentId = 'checkpoint-agent-1';

  beforeEach(async () => {
    run(`INSERT OR IGNORE INTO agents (id, name, role, workspace_id, status)
         VALUES (?, 'Checkpoint Agent', 'builder', 'default', 'working')`, [agentId]);
    run(`INSERT OR REPLACE INTO tasks (id, title, workspace_id, business_id, status, assigned_agent_id, updated_at, created_at)
         VALUES (?, 'Checkpoint Task', 'default', 'default', 'in_progress', ?, datetime('now'), datetime('now'))`, [taskId, agentId]);
    run(`INSERT OR REPLACE INTO agent_health (id, agent_id, task_id, health_state, updated_at)
         VALUES ('health-checkpoint-1', ?, ?, 'working', datetime('now'))`, [agentId, taskId]);
    broadcastMock.mockClear();
  });

  afterEach(() => {
    run('DELETE FROM work_checkpoints WHERE task_id = ?', [taskId]);
    run('DELETE FROM agent_health WHERE agent_id = ?', [agentId]);
    run('DELETE FROM tasks WHERE id = ?', [taskId]);
    run('DELETE FROM agents WHERE id = ?', [agentId]);
  });

  test('saveCheckpoint persists JSON payloads and updates agent health', async () => {
    const { saveCheckpoint, getLatestCheckpoint } = await import('@/lib/checkpoint');

    const checkpoint = saveCheckpoint({
      taskId,
      agentId,
      checkpointType: 'manual',
      stateSummary: 'Working through the implementation',
      filesSnapshot: [{ path: 'src/app/page.tsx', hash: 'abc123', size: 42 }],
      contextData: {
        current_step: 'wire up state',
        completed_steps: ['parse inputs'],
        remaining_steps: ['render UI'],
        notes: 'Remember to keep tests green',
      },
    });

    expect(checkpoint.task_id).toBe(taskId);
    expect(checkpoint.checkpoint_type).toBe('manual');
    expect(broadcastMock).toHaveBeenCalledWith({
      type: 'checkpoint_saved',
      payload: expect.objectContaining({ id: checkpoint.id }),
    });

    const health = queryOne<{ last_checkpoint_at: string | null; updated_at: string }>(
      'SELECT last_checkpoint_at, updated_at FROM agent_health WHERE agent_id = ?',
      [agentId]
    );
    expect(health.last_checkpoint_at).not.toBeNull();
    expect(health.updated_at).toBe(health.last_checkpoint_at);

    const latest = getLatestCheckpoint(taskId);
    expect(latest?.id).toBe(checkpoint.id);
    expect(latest?.files_snapshot).toEqual([
      { path: 'src/app/page.tsx', hash: 'abc123', size: 42 },
    ]);
    expect(latest?.context_data).toEqual({
      current_step: 'wire up state',
      completed_steps: ['parse inputs'],
      remaining_steps: ['render UI'],
      notes: 'Remember to keep tests green',
    });
  });

  test('getCheckpoints returns checkpoints newest-first and buildCheckpointContext formats them', async () => {
    const { getCheckpoints, buildCheckpointContext } = await import('@/lib/checkpoint');

    run(
      `INSERT INTO work_checkpoints (id, task_id, agent_id, checkpoint_type, state_summary, files_snapshot, context_data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ,[
        'cp-1',
        taskId,
        agentId,
        'auto',
        'Initial pass',
        JSON.stringify([{ path: 'src/first.ts', hash: 'h1', size: 12 }]),
        JSON.stringify({ current_step: 'first', completed_steps: ['a'], notes: 'keep going' }),
        '2026-04-11T10:00:00.000Z',
      ]);
    run(
      `INSERT INTO work_checkpoints (id, task_id, agent_id, checkpoint_type, state_summary, files_snapshot, context_data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ,[
        'cp-2',
        taskId,
        agentId,
        'manual',
        'Follow-up pass',
        null,
        JSON.stringify({ remaining_steps: ['b', 'c'] }),
        '2026-04-11T11:00:00.000Z',
      ]);

    const checkpoints = getCheckpoints(taskId);
    expect(checkpoints.map((item) => item.id)).toEqual(['cp-2', 'cp-1']);

    const context = buildCheckpointContext(taskId);
    assert.ok(context);
    expect(context).toContain('CRASH RECOVERY');
    expect(context).toContain('Follow-up pass');
    expect(context).toContain('Remaining steps:** b, c');
  });
});
