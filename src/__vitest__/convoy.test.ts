import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { queryOne, run } from '@/lib/db';

const {
  broadcastMock,
  notifyLearnerMock,
  endTaskSessionMock,
  loggerMock,
} = vi.hoisted(() => ({
  broadcastMock: vi.fn(),
  notifyLearnerMock: vi.fn().mockResolvedValue(undefined),
  endTaskSessionMock: vi.fn(),
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/events', () => ({
  broadcast: broadcastMock,
}));

vi.mock('@/lib/learner', () => ({
  notifyLearner: notifyLearnerMock,
}));

vi.mock('@/lib/openclaw/task-session-registry', () => ({
  endTaskSession: endTaskSessionMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMock,
}));

function insertParentTask(id: string) {
  run(
    `INSERT INTO tasks (
       id, title, description, status, priority, workspace_id, business_id, created_at, updated_at
     ) VALUES (?, ?, ?, 'inbox', 'normal', 'default', 'default', datetime('now'), datetime('now'))`,
    [id, id, `${id} description`]
  );
}

function insertAgent(id: string, name = id, role = 'builder') {
  run(
    `INSERT INTO agents (id, name, role, workspace_id, status)
     VALUES (?, ?, ?, 'default', 'working')`,
    [id, name, role]
  );
}

function cleanupRows() {
  run(`DELETE FROM task_activities WHERE task_id LIKE 'convoy-%'`);
  run(`DELETE FROM events WHERE task_id LIKE 'convoy-%'`);
  run(`DELETE FROM tasks WHERE convoy_id IN (SELECT id FROM convoys WHERE parent_task_id LIKE 'convoy-%')`);
  run(`DELETE FROM convoy_subtasks WHERE convoy_id IN (SELECT id FROM convoys WHERE parent_task_id LIKE 'convoy-%')`);
  run(`DELETE FROM convoys WHERE parent_task_id LIKE 'convoy-%'`);
  run(`DELETE FROM tasks WHERE id LIKE 'convoy-%'`);
  run(`DELETE FROM agents WHERE id LIKE 'convoy-agent-%'`);
}

beforeEach(() => {
  broadcastMock.mockClear();
  notifyLearnerMock.mockClear();
  endTaskSessionMock.mockClear();
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
});

afterEach(() => {
  cleanupRows();
});

describe('convoy', () => {
  test('creates a convoy, exposes dispatchable subtasks, and records progress', async () => {
    const { createConvoy, getConvoy, getDispatchableSubtasks, updateConvoyProgress } = await import('@/lib/convoy');

    insertParentTask('convoy-parent-create');

    const convoy = createConvoy({
      parentTaskId: 'convoy-parent-create',
      name: 'Launch convoy',
      strategy: 'manual',
      decompositionSpec: 'Launch the thing',
      subtasks: [
        { title: 'Draft announcement' },
        { title: 'Prep rollout', depends_on: ['convoy-nonexistent-dependency'] },
      ],
    });

    expect(convoy.status).toBe('active');
    expect(convoy.total_subtasks).toBe(2);

    const parent = queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', ['convoy-parent-create']);
    expect(parent?.status).toBe('convoy_active');

    const loaded = getConvoy('convoy-parent-create');
    expect(loaded?.subtasks).toHaveLength(2);
    expect(loaded?.subtasks[1].depends_on).toEqual(['convoy-nonexistent-dependency']);

    const dispatchable = getDispatchableSubtasks(convoy.id);
    expect(dispatchable).toHaveLength(1);
    expect(dispatchable[0].task_id).toBe(loaded?.subtasks[0].task.id);

    run(`UPDATE tasks SET status = 'done' WHERE id = ?`, [loaded?.subtasks[0].task.id]);
    run(`UPDATE tasks SET status = 'in_progress', status_reason = 'blocked' WHERE id = ?`, [loaded?.subtasks[1].task.id]);

    updateConvoyProgress(convoy.id);

    const updatedConvoy = queryOne<{ completed_subtasks: number; failed_subtasks: number }>(
      'SELECT completed_subtasks, failed_subtasks FROM convoys WHERE id = ?',
      [convoy.id]
    );
    expect(updatedConvoy).toEqual({ completed_subtasks: 1, failed_subtasks: 1 });
    expect(broadcastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'convoy_progress' }));
  });

  test('completes a convoy when every subtask is done', async () => {
    const { createConvoy, getConvoy, checkConvoyCompletion } = await import('@/lib/convoy');

    insertParentTask('convoy-parent-complete');

    const convoy = createConvoy({
      parentTaskId: 'convoy-parent-complete',
      name: 'Complete convoy',
      strategy: 'planning',
      subtasks: [{ title: 'Ship it' }],
    });

    const loaded = getConvoy('convoy-parent-complete');
    const subtaskId = loaded?.subtasks[0].task.id;
    run(`UPDATE tasks SET status = 'done' WHERE id = ?`, [subtaskId]);

    const completed = checkConvoyCompletion(convoy.id);
    expect(completed).toBe(true);

    const updatedParent = queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', ['convoy-parent-complete']);
    const updatedConvoy = queryOne<{ status: string }>('SELECT status FROM convoys WHERE id = ?', [convoy.id]);
    expect(updatedParent?.status).toBe('review');
    expect(updatedConvoy?.status).toBe('done');
    expect(notifyLearnerMock).toHaveBeenCalledWith(
      'convoy-parent-complete',
      expect.objectContaining({
        previousStatus: 'convoy_active',
        newStatus: 'review',
        passed: true,
      })
    );
    expect(broadcastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'convoy_completed' }));
  });

  test('fails a convoy when too many subtasks break, then deletes it cleanly', async () => {
    const { createConvoy, getConvoy, checkConvoyCompletion, deleteConvoy } = await import('@/lib/convoy');

    insertParentTask('convoy-parent-fail');
    insertAgent('convoy-agent-owner', 'Owner Bot');

    const convoy = createConvoy({
      parentTaskId: 'convoy-parent-fail',
      name: 'Failing convoy',
      strategy: 'ai',
      subtasks: [
        { title: 'First failure' },
        { title: 'Second failure' },
        { title: 'Active cleanup', agent_id: 'convoy-agent-owner' },
      ],
    });

    const loaded = getConvoy('convoy-parent-fail');
    const [firstId, secondId, thirdId] = loaded?.subtasks.map((subtask) => subtask.task.id) ?? [];

    run(`UPDATE tasks SET status = 'in_progress', status_reason = 'broken' WHERE id = ?`, [firstId]);
    run(`UPDATE tasks SET status = 'in_progress', status_reason = 'broken' WHERE id = ?`, [secondId]);
    run(`UPDATE tasks SET status = 'assigned', assigned_agent_id = 'convoy-agent-owner' WHERE id = ?`, [thirdId]);

    const completed = checkConvoyCompletion(convoy.id);
    expect(completed).toBe(false);

    const failedConvoy = queryOne<{ status: string }>('SELECT status FROM convoys WHERE id = ?', [convoy.id]);
    const failedParent = queryOne<{ status: string; status_reason: string | null }>(
      'SELECT status, status_reason FROM tasks WHERE id = ?',
      ['convoy-parent-fail']
    );
    expect(failedConvoy?.status).toBe('failed');
    expect(failedParent?.status).toBe('review');
    expect(failedParent?.status_reason).toContain('Convoy failed');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(endTaskSessionMock).toHaveBeenCalledWith(expect.anything(), 'convoy-agent-owner', thirdId, expect.any(String));
    expect(notifyLearnerMock).toHaveBeenCalledWith(
      'convoy-parent-fail',
      expect.objectContaining({
        previousStatus: 'convoy_active',
        newStatus: 'review',
        passed: false,
      })
    );

    deleteConvoy(convoy.id);

    const deletedConvoy = queryOne<{ id: string }>('SELECT id FROM convoys WHERE id = ?', [convoy.id]);
    const resetParent = queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', ['convoy-parent-fail']);
    const remainingSubtasks = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM tasks WHERE convoy_id = ?',
      [convoy.id]
    );

    expect(deletedConvoy).toBeUndefined();
    expect(resetParent?.status).toBe('inbox');
    expect(remainingSubtasks?.count).toBe(0);
    expect(broadcastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'task_updated' }));
  });
});
