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

  cleanupTaskBeforeDeletion(db, { id: 'task-1', assigned_agent_id: 'agent-1' }, now);

  const session = db.prepare(`SELECT status, ended_at FROM openclaw_sessions WHERE id = ?`).get('session-1') as { status: string; ended_at: string | null };
  assert.deepEqual(session, { status: 'ended', ended_at: now });

  const port = db.prepare(`SELECT status, released_at FROM workspace_ports WHERE id = ?`).get('port-1') as { status: string; released_at: string | null };
  assert.deepEqual(port, { status: 'released', released_at: now });

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
