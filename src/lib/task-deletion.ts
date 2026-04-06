import type Database from 'better-sqlite3';
import type { Task } from '@/lib/types';

type CleanupDb = Pick<Database.Database, 'prepare'>;
type DeletableTask = Pick<Task, 'id' | 'assigned_agent_id'>;

function hasColumn(db: CleanupDb, table: string, column: string): boolean {
  const row = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return row.some(({ name }) => name === column);
}

function hasTable(db: CleanupDb, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

function runIfTableExists(db: CleanupDb, table: string, sql: string, params: unknown[]): void {
  if (!hasTable(db, table)) return;
  db.prepare(sql).run(...params);
}

export function cleanupTaskBeforeDeletion(db: CleanupDb, task: DeletableTask, now = new Date().toISOString()): void {
  const hasSessionUpdatedAt = hasColumn(db, 'openclaw_sessions', 'updated_at');
  const hasAgentUpdatedAt = hasColumn(db, 'agents', 'updated_at');

  runIfTableExists(
    db,
    'workspace_ports',
    `UPDATE workspace_ports
     SET status = 'released', released_at = ?
     WHERE task_id = ? AND status = 'active'`,
    [now, task.id]
  );
  runIfTableExists(db, 'workspace_ports', `DELETE FROM workspace_ports WHERE task_id = ?`, [task.id]);

  runIfTableExists(db, 'workspace_merges', `DELETE FROM workspace_merges WHERE task_id = ?`, [task.id]);

  runIfTableExists(db, 'ideas', `UPDATE ideas SET task_id = NULL WHERE task_id = ?`, [task.id]);
  runIfTableExists(db, 'conversations', `UPDATE conversations SET task_id = NULL WHERE task_id = ?`, [task.id]);
  runIfTableExists(db, 'knowledge_entries', `UPDATE knowledge_entries SET task_id = NULL WHERE task_id = ?`, [task.id]);
  runIfTableExists(db, 'content_inventory', `UPDATE content_inventory SET task_id = NULL WHERE task_id = ?`, [task.id]);
  runIfTableExists(db, 'cost_events', `UPDATE cost_events SET task_id = NULL WHERE task_id = ?`, [task.id]);
  runIfTableExists(db, 'agent_health', `UPDATE agent_health SET task_id = NULL WHERE task_id = ?`, [task.id]);
  runIfTableExists(db, 'rollback_history', `UPDATE rollback_history SET task_id = NULL WHERE task_id = ?`, [task.id]);
  runIfTableExists(db, 'product_skills', `UPDATE product_skills SET created_by_task_id = NULL WHERE created_by_task_id = ?`, [task.id]);
  runIfTableExists(db, 'skill_reports', `DELETE FROM skill_reports WHERE task_id = ?`, [task.id]);

  if (task.assigned_agent_id) {
    if (hasSessionUpdatedAt) {
      runIfTableExists(
        db,
        'openclaw_sessions',
        `UPDATE openclaw_sessions
         SET status = 'ended', ended_at = ?, updated_at = ?
         WHERE agent_id = ? AND task_id = ? AND status = 'active'`,
        [now, now, task.assigned_agent_id, task.id]
      );
    } else {
      runIfTableExists(
        db,
        'openclaw_sessions',
        `UPDATE openclaw_sessions
         SET status = 'ended', ended_at = ?
         WHERE agent_id = ? AND task_id = ? AND status = 'active'`,
        [now, task.assigned_agent_id, task.id]
      );
    }

    const otherActive = db.prepare(
      `SELECT COUNT(*) as count FROM tasks
       WHERE assigned_agent_id = ?
         AND status IN ('assigned', 'in_progress', 'convoy_active', 'testing', 'verification')
         AND id != ?`
    ).get(task.assigned_agent_id, task.id) as { count: number } | undefined;

    if (!otherActive || otherActive.count === 0) {
      if (hasAgentUpdatedAt) {
        runIfTableExists(
          db,
          'agents',
          `UPDATE agents SET status = 'standby', updated_at = ? WHERE id = ? AND status = 'working'`,
          [now, task.assigned_agent_id]
        );
      } else {
        runIfTableExists(
          db,
          'agents',
          `UPDATE agents SET status = 'standby' WHERE id = ? AND status = 'working'`,
          [task.assigned_agent_id]
        );
      }
    }
  }
}