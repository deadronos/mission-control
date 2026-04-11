import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { queryAll, queryOne, run } from '@/lib/db';

const {
  broadcastMock,
  recordLearnerMock,
  escalateFailureMock,
  pickDynamicAgentMock,
  getMissionControlUrlMock,
  getApiTokenMock,
  loggerMock,
} = vi.hoisted(() => ({
  broadcastMock: vi.fn(),
  recordLearnerMock: vi.fn(() => Promise.resolve()),
  escalateFailureMock: vi.fn(() => Promise.resolve()),
  pickDynamicAgentMock: vi.fn(() => null),
  getMissionControlUrlMock: vi.fn(() => 'http://mission.local'),
  getApiTokenMock: vi.fn(() => undefined),
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/events', () => ({
  broadcast: broadcastMock,
}));

vi.mock('@/lib/task-governance', () => ({
  recordLearnerOnTransition: recordLearnerMock,
  escalateFailureIfNeeded: escalateFailureMock,
  pickDynamicAgent: pickDynamicAgentMock,
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

describe('workflow engine', () => {
  const workspaceId = 'workflow-workspace-1';
  const otherWorkspaceId = 'workflow-workspace-2';
  const builderAgentId = 'workflow-agent-builder';
  const reviewerAgentId = 'workflow-agent-reviewer';

  beforeEach(() => {
    run(`INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, 'Workflow Workspace', 'workflow-workspace')`, [workspaceId]);
    run(`INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, 'Workflow Workspace 2', 'workflow-workspace-2')`, [otherWorkspaceId]);
    broadcastMock.mockClear();
    recordLearnerMock.mockClear();
    escalateFailureMock.mockClear();
    pickDynamicAgentMock.mockReset();
    pickDynamicAgentMock.mockReturnValue(null);
    getMissionControlUrlMock.mockClear();
    getApiTokenMock.mockClear();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
  });

  afterEach(() => {
    run('DELETE FROM task_activities WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)', [workspaceId]);
    run('DELETE FROM task_roles WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)', [workspaceId]);
    run('DELETE FROM tasks WHERE workspace_id = ?', [workspaceId]);
    run('DELETE FROM agents WHERE workspace_id = ?', [workspaceId]);
    run('DELETE FROM workflow_templates WHERE workspace_id = ?', [workspaceId]);
    run('DELETE FROM task_activities WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)', [otherWorkspaceId]);
    run('DELETE FROM task_roles WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)', [otherWorkspaceId]);
    run('DELETE FROM tasks WHERE workspace_id = ?', [otherWorkspaceId]);
    run('DELETE FROM workflow_templates WHERE workspace_id = ?', [otherWorkspaceId]);
  });

  function insertTemplate(id: string, stages: unknown[], failTargets: Record<string, string>, isDefault = 0) {
    run(
      `INSERT INTO workflow_templates (id, workspace_id, name, description, stages, fail_targets, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, workspaceId, `Template ${id}`, 'Workflow test template', JSON.stringify(stages), JSON.stringify(failTargets), isDefault]
    );
  }

  function insertTask(id: string, templateId: string | null, status = 'inbox', assignedAgentId: string | null = null) {
    run(
      `INSERT INTO tasks (
         id, title, description, status, priority, assigned_agent_id,
         workspace_id, business_id, workflow_template_id, is_subtask, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'normal', ?, ?, 'default', ?, 0, datetime('now'), datetime('now'))`,
      [id, `Task ${id}`, 'Workflow test task', status, assignedAgentId, workspaceId, templateId]
    );
  }

  function insertAgent(id: string, role: string, name = role) {
    run(
      `INSERT INTO agents (id, name, role, workspace_id, status, avatar_emoji, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'working', '🤖', datetime('now'), datetime('now'))`,
      [id, name, role, workspaceId]
    );
  }

  test('getTaskWorkflow prefers task-specific templates over workspace and global defaults', async () => {
    const { getTaskWorkflow } = await import('@/lib/workflow-engine');

    insertTemplate('workflow-global', [
      { status: 'in_progress', label: 'Builder', role: 'builder' },
    ], { in_progress: 'review' }, 1);
    insertTemplate('workflow-workspace', [
      { status: 'in_progress', label: 'Builder', role: 'builder' },
    ], { in_progress: 'review' }, 1);
    insertTemplate('workflow-task', [
      { status: 'in_progress', label: 'Builder', role: 'builder' },
    ], { in_progress: 'review' });

    insertTask('workflow-task-specific', 'workflow-task');
    insertTask('workflow-workspace-default', null);
    run(`UPDATE tasks SET workflow_template_id = 'workflow-workspace' WHERE id = ?`, ['workflow-workspace-default']);

    run(`INSERT INTO tasks (
         id, title, description, status, priority, assigned_agent_id,
         workspace_id, business_id, workflow_template_id, is_subtask, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'normal', ?, ?, 'default', ?, 0, datetime('now'), datetime('now'))`,
      ['workflow-global-default', 'Task workflow-global-default', 'Workflow test task', 'inbox', null, otherWorkspaceId, null]
    );

    const taskSpecific = getTaskWorkflow('workflow-task-specific');
    const workspaceDefault = getTaskWorkflow('workflow-workspace-default');
    const globalDefault = getTaskWorkflow('workflow-global-default');

    expect(taskSpecific?.id).toBe('workflow-task');
    expect(workspaceDefault?.id).toBe('workflow-workspace');
    expect(globalDefault?.id).toBe('workflow-global');
  });

  test('handleStageTransition assigns a task role and skips dispatch when requested', async () => {
    const { handleStageTransition } = await import('@/lib/workflow-engine');

    insertTemplate('workflow-task', [
      { status: 'in_progress', label: 'Builder', role: 'builder' },
      { status: 'review', label: 'Review', role: null },
    ], { in_progress: 'review' });
    insertTask('workflow-role-task', 'workflow-task', 'inbox');
    insertAgent(builderAgentId, 'builder', 'Builder Bot');
    run(
      `INSERT INTO task_roles (id, task_id, role, agent_id, created_at)
       VALUES ('role-1', ?, 'builder', ?, datetime('now'))`,
      ['workflow-role-task', builderAgentId]
    );

    const result = await handleStageTransition('workflow-role-task', 'in_progress', { skipDispatch: true });

    expect(result).toEqual({
      success: true,
      handedOff: true,
      newAgentId: builderAgentId,
      newAgentName: 'Builder Bot',
    });

    const task = queryOne<{ assigned_agent_id: string | null; planning_dispatch_error: string | null }>(
      'SELECT assigned_agent_id, planning_dispatch_error FROM tasks WHERE id = ?',
      ['workflow-role-task']
    );
    expect(task?.assigned_agent_id).toBe(builderAgentId);
    expect(task?.planning_dispatch_error).toBeNull();
    expect(recordLearnerMock).toHaveBeenCalled();
  });

  test('handleStageTransition falls back to assigned_agent_id when task roles are missing', async () => {
    const { handleStageTransition } = await import('@/lib/workflow-engine');

    insertTemplate('workflow-task', [
      { status: 'verification', label: 'Verification', role: 'reviewer' },
    ], { verification: 'review' });
    insertAgent(reviewerAgentId, 'reviewer', 'Reviewer Bot');
    insertTask('workflow-assigned-fallback', 'workflow-task', 'inbox', reviewerAgentId);

    const result = await handleStageTransition('workflow-assigned-fallback', 'verification', { skipDispatch: true });

    expect(result.success).toBe(true);
    expect(result.handedOff).toBe(true);
    expect(result.newAgentId).toBe(reviewerAgentId);
    expect(result.newAgentName).toBe('Reviewer Bot');
  });

  test('handleStageTransition records an error when no agent can be found', async () => {
    const { handleStageTransition } = await import('@/lib/workflow-engine');

    insertTemplate('workflow-task', [
      { status: 'testing', label: 'Testing', role: 'tester' },
    ], { testing: 'review' });
    insertTask('workflow-no-agent', 'workflow-task');

    const result = await handleStageTransition('workflow-no-agent', 'testing', { skipDispatch: true });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No eligible agent found/);

    const task = queryOne<{ planning_dispatch_error: string | null }>(
      'SELECT planning_dispatch_error FROM tasks WHERE id = ?',
      ['workflow-no-agent']
    );
    expect(task?.planning_dispatch_error).toMatch(/No eligible agent found/);
  });

  test('populateTaskRolesFromAgents matches exact, fuzzy, and learner roles', async () => {
    const { populateTaskRolesFromAgents } = await import('@/lib/workflow-engine');

    insertTemplate('workflow-task', [
      { status: 'in_progress', label: 'Builder', role: 'builder' },
      { status: 'review', label: 'Review', role: 'reviewer' },
    ], { in_progress: 'review' });
    insertTask('workflow-role-populate', 'workflow-task');
    insertAgent(builderAgentId, 'builder', 'Builder Bot');
    insertAgent(reviewerAgentId, 'reviewer', 'Reviewer Bot');
    insertAgent('workflow-agent-learner', 'learner', 'Learner Bot');

    populateTaskRolesFromAgents('workflow-role-populate', workspaceId);

    const roles = queryAll<{ role: string; agent_id: string }>(
      'SELECT role, agent_id FROM task_roles WHERE task_id = ? ORDER BY role ASC',
      ['workflow-role-populate']
    );
    expect(roles.map((row) => row.role)).toEqual(expect.arrayContaining(['builder', 'reviewer', 'learner']));
  });

  test('drainQueue advances the oldest queued task when the next stage is free', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    const { drainQueue } = await import('@/lib/workflow-engine');

    insertTemplate('workflow-task', [
      { status: 'assigned', label: 'Queue', role: null },
      { status: 'in_progress', label: 'Builder', role: 'builder' },
      { status: 'review', label: 'Review', role: null },
    ], { assigned: 'in_progress', in_progress: 'review' });
    insertTask('workflow-queue-oldest', 'workflow-task', 'assigned');
    insertTask('workflow-queue-other', 'workflow-task', 'assigned');
    insertAgent(builderAgentId, 'builder', 'Builder Bot');
    run(
      `INSERT INTO task_roles (id, task_id, role, agent_id, created_at)
       VALUES ('role-queue-1', ?, 'builder', ?, datetime('now'))`,
      ['workflow-queue-oldest', builderAgentId]
    );
    run(
      `UPDATE tasks SET updated_at = ? WHERE id = ?`,
      ['2026-04-11T10:00:00.000Z', 'workflow-queue-oldest']
    );
    run(
      `UPDATE tasks SET updated_at = ? WHERE id = ?`,
      ['2026-04-11T11:00:00.000Z', 'workflow-queue-other']
    );

    await drainQueue('workflow-queue-oldest', workspaceId);

    const drained = queryOne<{ status: string; assigned_agent_id: string | null }>(
      'SELECT status, assigned_agent_id FROM tasks WHERE id = ?',
      ['workflow-queue-oldest']
    );
    expect(drained?.status).toBe('in_progress');
    expect(drained?.assigned_agent_id).toBe(builderAgentId);
    expect(fetchMock).toHaveBeenCalled();
  });
});
