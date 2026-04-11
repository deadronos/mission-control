import { test } from 'vitest';
import assert from 'node:assert/strict';
import { run, queryOne } from '@/lib/db';
import {
  hasStageEvidence,
  canUseBoardOverride,
  auditBoardOverride,
  taskCanBeDone,
  ensureFixerExists,
  getFailureCountInStage,
  isActiveStatus,
  escalateFailureIfNeeded,
  pickDynamicAgent,
} from '@/lib/task-governance';

function seedTask(id: string, workspace = 'default') {
  run(
    `INSERT INTO tasks (id, title, status, priority, workspace_id, business_id, created_at, updated_at)
     VALUES (?, 'T', 'review', 'normal', ?, 'default', datetime('now'), datetime('now'))`,
    [id, workspace]
  );
}

test('evidence gate requires deliverable + activity', () => {
  const taskId = crypto.randomUUID();
  seedTask(taskId);

  assert.equal(hasStageEvidence(taskId), false);

  run(
    `INSERT INTO task_deliverables (id, task_id, deliverable_type, title, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 'file', 'index.html', datetime('now'))`,
    [taskId]
  );
  assert.equal(hasStageEvidence(taskId), false);

  run(
    `INSERT INTO task_activities (id, task_id, activity_type, message, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 'completed', 'did thing', datetime('now'))`,
    [taskId]
  );

  assert.equal(hasStageEvidence(taskId), true);
});

test('task cannot be done when status_reason indicates failure', () => {
  const taskId = crypto.randomUUID();
  seedTask(taskId);

  run(`UPDATE tasks SET status_reason = 'Validation failed: CSS broken' WHERE id = ?`, [taskId]);
  run(
    `INSERT INTO task_deliverables (id, task_id, deliverable_type, title, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 'file', 'index.html', datetime('now'))`,
    [taskId]
  );
  run(
    `INSERT INTO task_activities (id, task_id, activity_type, message, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 'completed', 'did thing', datetime('now'))`,
    [taskId]
  );

  assert.equal(taskCanBeDone(taskId), false);
});

test('task can be done when evidence is present and status is clean', () => {
  const taskId = crypto.randomUUID();
  seedTask(taskId);

  run(
    `INSERT INTO task_deliverables (id, task_id, deliverable_type, title, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 'file', 'index.html', datetime('now'))`,
    [taskId]
  );
  run(
    `INSERT INTO task_activities (id, task_id, activity_type, message, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 'completed', 'did thing', datetime('now'))`,
    [taskId]
  );

  assert.equal(taskCanBeDone(taskId), true);
});

test('isActiveStatus only accepts workflow statuses that can still move', () => {
  assert.equal(isActiveStatus('review'), true);
  assert.equal(isActiveStatus('verification'), true);
  assert.equal(isActiveStatus('done'), false);
  assert.equal(isActiveStatus('archived'), false);
});

test('auditBoardOverride records the override event and metadata', () => {
  const taskId = crypto.randomUUID();
  seedTask(taskId);

  auditBoardOverride(taskId, 'review', 'done', 'manual override');

  const event = queryOne<{ message: string; metadata: string }>(
    `SELECT message, metadata FROM events WHERE task_id = ? AND type = 'system' ORDER BY created_at DESC LIMIT 1`,
    [taskId]
  );

  assert.ok(event);
  assert.equal(event?.message, 'Board override: review → done');
  assert.match(event?.metadata ?? '', /"boardOverride":true/);
  assert.match(event?.metadata ?? '', /"reason":"manual override"/);
});

test('ensureFixerExists creates fixer when missing', () => {
  run(`DELETE FROM task_roles WHERE role = 'fixer'`);
  run(`DELETE FROM tasks WHERE assigned_agent_id IN (SELECT id FROM agents WHERE role = 'fixer' AND workspace_id = 'default')`);
  run(`DELETE FROM agents WHERE role = 'fixer' AND workspace_id = 'default'`);

  const fixer = ensureFixerExists('default');
  assert.equal(fixer.created, true);

  const stored = queryOne<{ id: string; role: string }>('SELECT id, role FROM agents WHERE id = ?', [fixer.id]);
  assert.ok(stored);
  assert.equal(stored?.role, 'fixer');
});

test('failure counter reads status_changed failure events', () => {
  const taskId = crypto.randomUUID();
  seedTask(taskId);

  run(
    `INSERT INTO task_activities (id, task_id, activity_type, message, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 'status_changed', 'Stage failed: verification → in_progress (reason: x)', datetime('now'))`,
    [taskId]
  );
  run(
    `INSERT INTO task_activities (id, task_id, activity_type, message, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 'status_changed', 'Stage failed: verification → in_progress (reason: y)', datetime('now'))`,
    [taskId]
  );

  assert.equal(getFailureCountInStage(taskId, 'verification'), 2);
});

test('escalateFailureIfNeeded leaves the task unchanged before the threshold', async () => {
  const taskId = crypto.randomUUID();
  seedTask(taskId);

  run(
    `INSERT INTO task_activities (id, task_id, activity_type, message, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 'status_changed', 'Stage failed: verification → in_progress (reason: x)', datetime('now'))`,
    [taskId]
  );

  await escalateFailureIfNeeded(taskId, 'verification');

  const task = queryOne<{ assigned_agent_id: string | null; status_reason: string | null }>(
    'SELECT assigned_agent_id, status_reason FROM tasks WHERE id = ?',
    [taskId]
  );
  assert.ok(task);
  assert.equal(task?.assigned_agent_id, null);
  assert.equal(task?.status_reason, null);

  const role = queryOne<{ id: string }>('SELECT id FROM task_roles WHERE task_id = ?', [taskId]);
  assert.equal(role, undefined);
});

test('escalateFailureIfNeeded reassigns the task to a fixer after repeated failures', async () => {
  const taskId = crypto.randomUUID();
  const fixerId = crypto.randomUUID();
  seedTask(taskId);

  run(`DELETE FROM agents WHERE role IN ('fixer', 'senior') AND workspace_id = 'default'`);
  run(
    `INSERT INTO agents (id, name, role, status, is_master, workspace_id, source, created_at, updated_at)
     VALUES (?, 'Manual Fixer', 'fixer', 'working', 0, 'default', 'local', datetime('now'), datetime('now'))`,
    [fixerId]
  );

  run(
    `INSERT INTO task_activities (id, task_id, activity_type, message, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 'status_changed', 'Stage failed: verification → in_progress (reason: x)', datetime('now'))`,
    [taskId]
  );
  run(
    `INSERT INTO task_activities (id, task_id, activity_type, message, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 'status_changed', 'Stage failed: verification → in_progress (reason: y)', datetime('now'))`,
    [taskId]
  );

  await escalateFailureIfNeeded(taskId, 'verification');

  const task = queryOne<{ assigned_agent_id: string | null; status_reason: string | null }>(
    'SELECT assigned_agent_id, status_reason FROM tasks WHERE id = ?',
    [taskId]
  );
  assert.ok(task);
  assert.equal(task?.assigned_agent_id, fixerId);
  assert.equal(task?.status_reason, 'Escalated after repeated failures in verification');

  const role = queryOne<{ role: string; agent_id: string }>(
    'SELECT role, agent_id FROM task_roles WHERE task_id = ?',
    [taskId]
  );
  assert.ok(role);
  assert.equal(role?.role, 'fixer');
  assert.equal(role?.agent_id, fixerId);

  const activity = queryOne<{ message: string }>(
    `SELECT message FROM task_activities
     WHERE task_id = ? AND activity_type = 'status_changed' AND message LIKE 'Escalated to %'
     ORDER BY created_at DESC LIMIT 1`,
    [taskId]
  );
  assert.ok(activity);
  assert.match(activity?.message ?? '', /Escalated to Manual Fixer after repeated failures in verification/);

  run('DELETE FROM task_roles WHERE task_id = ?', [taskId]);
  run('DELETE FROM task_activities WHERE task_id = ?', [taskId]);
  run(`DELETE FROM task_roles WHERE role = 'fixer' AND agent_id = ?`, [fixerId]);
  run('DELETE FROM tasks WHERE id = ?', [taskId]);
  run('DELETE FROM agents WHERE id = ?', [fixerId]);
});

test('canUseBoardOverride requires the feature flag and matching header', () => {
  const original = process.env.BOARD_OVERRIDE_ENABLED;
  process.env.BOARD_OVERRIDE_ENABLED = 'false';

  try {
    const disabled = new Request('http://localhost', {
      headers: { 'x-mc-board-override': 'true' },
    });
    assert.equal(canUseBoardOverride(disabled), false);

    process.env.BOARD_OVERRIDE_ENABLED = 'true';
    const enabled = new Request('http://localhost', {
      headers: { 'x-mc-board-override': 'true' },
    });
    const legacy = new Request('http://localhost', {
      headers: { 'x-autensa-board-override': 'true' },
    });

    assert.equal(canUseBoardOverride(enabled), true);
    assert.equal(canUseBoardOverride(legacy), true);
  } finally {
    process.env.BOARD_OVERRIDE_ENABLED = original;
  }
});

test('pickDynamicAgent prefers planning agents and falls back to role-matched agents', () => {
  const planningTaskId = crypto.randomUUID();
  const fallbackTaskId = crypto.randomUUID();
  const planningAgentId = crypto.randomUUID();

  run(
    `INSERT OR IGNORE INTO workspaces (id, name, slug)
     VALUES ('default', 'Default', 'default')`
  );

  run(
    `INSERT INTO tasks (id, title, status, priority, workspace_id, business_id, planning_agents, created_at, updated_at)
     VALUES (?, 'Planning lookup', 'inbox', 'normal', 'default', 'default', ?, datetime('now'), datetime('now'))`,
    [
      planningTaskId,
      JSON.stringify([{ agent_id: planningAgentId, role: 'builder' }]),
    ]
  );
  run(
    `INSERT INTO agents (id, name, role, status, is_master, workspace_id, source, created_at, updated_at)
     VALUES (?, 'Planning Builder', 'builder', 'working', 0, 'default', 'local', datetime('now'), datetime('now'))`,
    [planningAgentId]
  );

  assert.deepEqual(pickDynamicAgent(planningTaskId, 'builder'), {
    id: planningAgentId,
    name: 'Planning Builder',
  });

  const skippedTaskId = crypto.randomUUID();
  const skippedPlanningAgentId = crypto.randomUUID();
  const fallbackRoleAgentId = crypto.randomUUID();
  const globalFallbackAgentId = crypto.randomUUID();
  const fallbackRole = 'qa-fallback';

  run(
    `INSERT INTO tasks (id, title, status, priority, workspace_id, business_id, planning_agents, created_at, updated_at)
     VALUES (?, 'Offline planning lookup', 'inbox', 'normal', 'default', 'default', ?, datetime('now'), datetime('now'))`,
    [
      skippedTaskId,
      JSON.stringify([{ agent_id: skippedPlanningAgentId, role: fallbackRole }]),
    ]
  );
  run(
    `INSERT INTO agents (id, name, role, status, is_master, workspace_id, source, created_at, updated_at)
     VALUES (?, 'Offline Fallback', ?, 'offline', 0, 'default', 'local', datetime('now'), datetime('now'))`,
    [skippedPlanningAgentId, fallbackRole]
  );
  run(
    `INSERT INTO agents (id, name, role, status, is_master, workspace_id, source, created_at, updated_at)
     VALUES (?, 'Fallback QA', ?, 'working', 0, 'default', 'local', datetime('now'), datetime('now'))`,
    [fallbackRoleAgentId, fallbackRole]
  );

  assert.deepEqual(pickDynamicAgent(skippedTaskId, fallbackRole), {
    id: fallbackRoleAgentId,
    name: 'Fallback QA',
  });

  run(
    `INSERT INTO tasks (id, title, status, priority, workspace_id, business_id, created_at, updated_at)
     VALUES (?, 'Fallback lookup', 'inbox', 'normal', 'default', 'default', datetime('now'), datetime('now'))`,
    [fallbackTaskId]
  );
  run(
    `INSERT INTO agents (id, name, role, status, is_master, workspace_id, source, created_at, updated_at)
     VALUES (?, 'Fallback Builder', 'qa', 'working', 0, 'default', 'local', datetime('now'), datetime('now'))`,
    [globalFallbackAgentId]
  );

  assert.deepEqual(pickDynamicAgent(fallbackTaskId, 'qa'), {
    id: globalFallbackAgentId,
    name: 'Fallback Builder',
  });

  run('DELETE FROM tasks WHERE id IN (?, ?)', [planningTaskId, fallbackTaskId]);
  run('DELETE FROM tasks WHERE id = ?', [skippedTaskId]);
  run('DELETE FROM agents WHERE id IN (?, ?, ?)', [planningAgentId, globalFallbackAgentId, skippedPlanningAgentId]);
  run('DELETE FROM agents WHERE id = ?', [fallbackRoleAgentId]);
});
