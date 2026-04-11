import path from 'path';
import fs from 'fs';
import { closeDb } from './index';

export function testDbPath(): string {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  return path.join(process.cwd(), `.tmp/mission-control-test-${process.pid}.db`);
}

export function resetTestDb(): void {
  try {
    closeDb();
  } catch (e) {
    // ignore
  }
  const dbPath = testDbPath();
  if (dbPath !== ':memory:' && fs.existsSync(dbPath)) {
    try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
  }
}
