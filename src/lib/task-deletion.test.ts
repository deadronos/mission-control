import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupTaskBeforeDeletion } from './task-deletion';

async function createTestDb() {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      assigned_agent_id TEXT,
      status TEXT NOT NULL
    );

    CREATE TABLE openclaw_sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      task_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      ended_at TEXT,
      updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE workspace_ports (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      port INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      released_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE workspace_merges (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL
    );

    CREATE TABLE ideas (
      id TEXT PRIMARY KEY,
      task_id TEXT
    );

    CREATE TABLE knowledge_entries (
      id TEXT PRIMARY KEY,
      task_id TEXT
    );

    CREATE TABLE content_inventory (
      id TEXT PRIMARY KEY,
      task_id TEXT
    );

    CREATE TABLE cost_events (
      id TEXT PRIMARY KEY,
      task_id TEXT
    );

    CREATE TABLE agent_health (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      task_id TEXT
    );

    CREATE TABLE rollback_history (
      id TEXT PRIMARY KEY,
      task_id TEXT
    );

    CREATE TABLE product_skills (
      id TEXT PRIMARY KEY,
      created_by_task_id TEXT
    );

    CREATE TABLE skill_reports (
      id TEXT PRIMARY KEY,
      task_id TEXT
    );
  `);

  return db;
}

test('cleanupTaskBeforeDeletion stops the task session, releases the port, and idles the agent when no work remains', async () => {
  const db = await createTestDb();
  const now = '2026-04-07T10:00:00.000Z';

  db.prepare(`INSERT INTO agents (id, status) VALUES (?, ?)`).run('agent-1', 'working');
  db.prepare(`INSERT INTO tasks (id, title, assigned_agent_id, status) VALUES (?, ?, ?, ?)`).run('task-1', 'Task 1', 'agent-1', 'in_progress');
  db.prepare(`INSERT INTO openclaw_sessions (id, agent_id, task_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`).run('session-1', 'agent-1', 'task-1', now, now);
  db.prepare(`INSERT INTO workspace_ports (id, task_id, port, status, created_at) VALUES (?, ?, 4201, 'active', ?)`).run('port-1', 'task-1', now);
  db.prepare(`INSERT INTO workspace_merges (id, task_id, workspace_path) VALUES (?, ?, ?)`).run('merge-1', 'task-1', '/tmp/task-1');

  cleanupTaskBeforeDeletion(db, { id: 'task-1', assigned_agent_id: 'agent-1' }, now);

  const session = db.prepare(`SELECT status, ended_at FROM openclaw_sessions WHERE id = ?`).get('session-1') as { status: string; ended_at: string | null };
  assert.deepEqual(session, { status: 'ended', ended_at: now });

  const portCount = db.prepare(`SELECT COUNT(*) as count FROM workspace_ports WHERE id = ?`).get('port-1') as { count: number };
  assert.equal(portCount.count, 0);

  const mergeCount = db.prepare(`SELECT COUNT(*) as count FROM workspace_merges WHERE id = ?`).get('merge-1') as { count: number };
  assert.equal(mergeCount.count, 0);

  const agent = db.prepare(`SELECT status FROM agents WHERE id = ?`).get('agent-1') as { status: string };
  assert.equal(agent.status, 'standby');

  db.close();
});

test('cleanupTaskBeforeDeletion keeps the agent working when another active task remains', async () => {
  const db = await createTestDb();
  const now = '2026-04-07T10:00:00.000Z';

  db.prepare(`INSERT INTO agents (id, status) VALUES (?, ?)`).run('agent-1', 'working');
  db.prepare(`INSERT INTO tasks (id, title, assigned_agent_id, status) VALUES (?, ?, ?, ?)`).run('task-1', 'Task 1', 'agent-1', 'in_progress');
  db.prepare(`INSERT INTO tasks (id, title, assigned_agent_id, status) VALUES (?, ?, ?, ?)`).run('task-2', 'Task 2', 'agent-1', 'testing');
  db.prepare(`INSERT INTO openclaw_sessions (id, agent_id, task_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`).run('session-1', 'agent-1', 'task-1', now, now);
  db.prepare(`INSERT INTO workspace_ports (id, task_id, port, status, created_at) VALUES (?, ?, 4201, 'active', ?)`).run('port-1', 'task-1', now);

  cleanupTaskBeforeDeletion(db, { id: 'task-1', assigned_agent_id: 'agent-1' }, now);

  const agent = db.prepare(`SELECT status FROM agents WHERE id = ?`).get('agent-1') as { status: string };
  assert.equal(agent.status, 'working');

  const session = db.prepare(`SELECT status FROM openclaw_sessions WHERE id = ?`).get('session-1') as { status: string };
  assert.equal(session.status, 'ended');

  db.close();
});

test('cleanupTaskBeforeDeletion clears task-linked rows even when the task is unassigned', async () => {
  const db = await createTestDb();
  const now = '2026-04-07T10:00:00.000Z';

  db.prepare(`INSERT INTO tasks (id, title, assigned_agent_id, status) VALUES (?, ?, ?, ?)`).run('task-1', 'Task 1', null, 'open');
  db.prepare(`INSERT INTO ideas (id, task_id) VALUES (?, ?)`).run('idea-1', 'task-1');
  db.prepare(`INSERT INTO knowledge_entries (id, task_id) VALUES (?, ?)`).run('knowledge-1', 'task-1');
  db.prepare(`INSERT INTO content_inventory (id, task_id) VALUES (?, ?)`).run('content-1', 'task-1');
  db.prepare(`INSERT INTO cost_events (id, task_id) VALUES (?, ?)`).run('cost-1', 'task-1');
  db.prepare(`INSERT INTO agent_health (id, agent_id, task_id) VALUES (?, ?, ?)`).run('health-1', 'agent-1', 'task-1');
  db.prepare(`INSERT INTO rollback_history (id, task_id) VALUES (?, ?)`).run('rollback-1', 'task-1');
  db.prepare(`INSERT INTO product_skills (id, created_by_task_id) VALUES (?, ?)`).run('skill-1', 'task-1');
  db.prepare(`INSERT INTO skill_reports (id, task_id) VALUES (?, ?)`).run('report-1', 'task-1');

  cleanupTaskBeforeDeletion(db, { id: 'task-1', assigned_agent_id: null as unknown as string }, now);

  const idea = db.prepare(`SELECT task_id FROM ideas WHERE id = ?`).get('idea-1') as { task_id: string | null };
  assert.equal(idea.task_id, null);

  const knowledge = db.prepare(`SELECT task_id FROM knowledge_entries WHERE id = ?`).get('knowledge-1') as { task_id: string | null };
  assert.equal(knowledge.task_id, null);

  const content = db.prepare(`SELECT task_id FROM content_inventory WHERE id = ?`).get('content-1') as { task_id: string | null };
  assert.equal(content.task_id, null);

  const costEvent = db.prepare(`SELECT task_id FROM cost_events WHERE id = ?`).get('cost-1') as { task_id: string | null };
  assert.equal(costEvent.task_id, null);

  const health = db.prepare(`SELECT task_id FROM agent_health WHERE id = ?`).get('health-1') as { task_id: string | null };
  assert.equal(health.task_id, null);

  const rollback = db.prepare(`SELECT task_id FROM rollback_history WHERE id = ?`).get('rollback-1') as { task_id: string | null };
  assert.equal(rollback.task_id, null);

  const productSkill = db.prepare(`SELECT created_by_task_id FROM product_skills WHERE id = ?`).get('skill-1') as { created_by_task_id: string | null };
  assert.equal(productSkill.created_by_task_id, null);

  const report = db.prepare(`SELECT COUNT(*) as count FROM skill_reports WHERE id = ?`).get('report-1') as { count: number };
  assert.equal(report.count, 0);

  db.close();
});
