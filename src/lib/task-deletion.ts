import type Database from 'better-sqlite3';
import type { Task } from '@/lib/types';

type CleanupDb = Pick<Database.Database, 'prepare'>;
type DeletableTask = Pick<Task, 'id' | 'assigned_agent_id'>;

function hasColumn(db: CleanupDb, table: string, column: string): boolean {
  const row = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return row.some(({ name }) => name === column);
}

export function cleanupTaskBeforeDeletion(db: CleanupDb, task: DeletableTask, now = new Date().toISOString()): void {
  const hasSessionUpdatedAt = hasColumn(db, 'openclaw_sessions', 'updated_at');
  const hasAgentUpdatedAt = hasColumn(db, 'agents', 'updated_at');

  db.prepare(
    `UPDATE workspace_ports
     SET status = 'released', released_at = ?
     WHERE task_id = ? AND status = 'active'`
  ).run(now, task.id);

  if (!task.assigned_agent_id) {
    return;
  }

  if (hasSessionUpdatedAt) {
    db.prepare(
      `UPDATE openclaw_sessions
       SET status = 'ended', ended_at = ?, updated_at = ?
       WHERE agent_id = ? AND task_id = ? AND status = 'active'`
    ).run(now, now, task.assigned_agent_id, task.id);
  } else {
    db.prepare(
      `UPDATE openclaw_sessions
       SET status = 'ended', ended_at = ?
       WHERE agent_id = ? AND task_id = ? AND status = 'active'`
    ).run(now, task.assigned_agent_id, task.id);
  }

  const otherActive = db.prepare(
    `SELECT COUNT(*) as count FROM tasks
     WHERE assigned_agent_id = ?
       AND status IN ('assigned', 'in_progress', 'convoy_active', 'testing', 'verification')
       AND id != ?`
  ).get(task.assigned_agent_id, task.id) as { count: number } | undefined;

  if (!otherActive || otherActive.count === 0) {
    if (hasAgentUpdatedAt) {
      db.prepare(
        `UPDATE agents SET status = 'standby', updated_at = ? WHERE id = ? AND status = 'working'`
      ).run(now, task.assigned_agent_id);
    } else {
      db.prepare(
        `UPDATE agents SET status = 'standby' WHERE id = ? AND status = 'working'`
      ).run(task.assigned_agent_id);
    }
  }
}