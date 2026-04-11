import { logger } from '@/lib/logger';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { schema } from './baseline';
import { runMigrations } from './migrations';
import { ensureCatalogSyncScheduled } from '@/lib/agent-catalog-sync';

const DB_PATH = (() => {
  // For test runs, default to a per-process file under .tmp so parallel workers don't collide.
  if (process.env.NODE_ENV === 'test' && !process.env.DATABASE_PATH) {
    const tmpDir = path.join(process.cwd(), '.tmp');
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) { /* ignore */ }
    return path.join(tmpDir, `mission-control-test-${process.pid}.db`);
  }
  return process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');
})();

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const isNewDb = !fs.existsSync(DB_PATH);
    
    db = new Database(DB_PATH, { timeout: 15000 }); // 15 seconds busy timeout
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL'); // Better performance with WAL
    db.pragma('foreign_keys = ON');

    // Initialize base schema (creates tables if they don't exist)
    db.exec(schema);

    // Run migrations for schema updates
    // This handles both new and existing databases
    runMigrations(db);

    // Recover orphaned autopilot cycles from prior crash/restart.
    // Skip this in tests to keep the database isolated and avoid background side effects.
    if (process.env.NODE_ENV !== 'test') {
      import('@/lib/autopilot/recovery').then(({ recoverOrphanedCycles }) =>
        recoverOrphanedCycles().catch(err => logger.warn('[Recovery] Failed:', err))
      );
    }

    // Keep Mission Control's agent catalog synced with OpenClaw-installed agents
    ensureCatalogSyncScheduled();
    
    if (isNewDb) {
      logger.info('[DB] New database created at:', DB_PATH);
    }
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Type-safe query helpers
export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDb().prepare(sql);
  return stmt.all(...params) as T[];
}

export function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
  const stmt = getDb().prepare(sql);
  return stmt.get(...params) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): Database.RunResult {
  const stmt = getDb().prepare(sql);
  return stmt.run(...params);
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  return db.transaction(fn)();
}

// Export migration utilities for CLI use
export { runMigrations, getMigrationStatus } from './migrations';
