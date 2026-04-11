import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
  getMigrationStatus: vi.fn(),
  dbPrepare: vi.fn(),
  dbGet: vi.fn(),
  dbClose: vi.fn(),
  s3Send: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: mocks.getDb,
  closeDb: mocks.closeDb,
}));

vi.mock('@/lib/db/migrations', () => ({
  getMigrationStatus: mocks.getMigrationStatus,
}));

vi.mock('better-sqlite3', () => ({
  default: class MockDatabase {
    prepare = mocks.dbPrepare;
    close = mocks.dbClose;
  },
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send = mocks.s3Send;
  },
  PutObjectCommand: class MockPutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  DeleteObjectCommand: class MockDeleteObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  ListObjectsV2Command: class MockListObjectsV2Command {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

let backupModule: typeof import('@/lib/backup');

const originalCwd = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-backup-branches-'));

beforeAll(async () => {
  backupModule = await import('@/lib/backup');
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });

  delete process.env.DATABASE_PATH;
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY;
  delete process.env.S3_SECRET_KEY;
  delete process.env.S3_REGION;

  mocks.getDb.mockReset();
  mocks.closeDb.mockReset();
  mocks.getMigrationStatus.mockReset();
  mocks.dbPrepare.mockReset();
  mocks.dbGet.mockReset();
  mocks.dbClose.mockReset();
  mocks.s3Send.mockReset();
});

function prepareWorkspace(name: string) {
  const cwd = path.join(tempRoot, name);
  fs.mkdirSync(cwd, { recursive: true });
  process.chdir(cwd);
  return cwd;
}

function createDbFile(cwd: string, filename = 'mission-control.db', contents = 'db') {
  const dbPath = path.join(cwd, filename);
  fs.writeFileSync(dbPath, contents);
  process.env.DATABASE_PATH = dbPath;
  return dbPath;
}

describe('backup helpers and backup lifecycle', () => {
  it('creates a local backup and formats sizes', async () => {
    const cwd = prepareWorkspace('create-local');
    const dbPath = createDbFile(cwd);

    mocks.getDb.mockReturnValue({ pragma: vi.fn() });
    mocks.getMigrationStatus.mockReturnValue({ applied: ['001', '002', '013'] });

    const result = await backupModule.createBackup();
    const backupFile = path.join(cwd, 'db-backups', result.backup.filename);

    expect(result.s3Uploaded).toBe(false);
    expect(result.backup.location).toBe('local');
    expect(result.backup.migrationVersion).toBe('013');
    expect(fs.existsSync(backupFile)).toBe(true);
    expect(fs.readFileSync(backupFile, 'utf8')).toBe(fs.readFileSync(dbPath, 'utf8'));
    expect(backupModule.formatBytes(0)).toBe('0 B');
    expect(backupModule.formatBytes(512)).toBe('512 B');
    expect(backupModule.formatBytes(1024)).toBe('1.0 KB');
    expect(backupModule.formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('lists backups, deduplicates filenames, and reads legacy files', async () => {
    const cwd = prepareWorkspace('list-backups');
    const canonical = path.join(cwd, 'db-backups');
    const legacy = path.join(cwd, 'backups');
    fs.mkdirSync(canonical, { recursive: true });
    fs.mkdirSync(legacy, { recursive: true });

    fs.writeFileSync(path.join(canonical, 'mc-backup-2026-04-05T10-11-13-v004.db'), 'mc');
    fs.writeFileSync(path.join(legacy, 'mc-backup-2026-04-05T10-11-13-v004.db'), 'duplicate');
    fs.writeFileSync(path.join(legacy, 'autensa-backup-2026-04-05T10-11-12-v003.db'), 'autensa');
    fs.writeFileSync(path.join(canonical, 'pre-restore-2026-04-05T10-11-14.db'), 'restore');
    fs.writeFileSync(path.join(canonical, 'ignore.txt'), 'skip');

    const backups = await backupModule.listBackups();

    expect(backups.map((item) => item.filename)).toEqual([
      'pre-restore-2026-04-05T10-11-14.db',
      'mc-backup-2026-04-05T10-11-13-v004.db',
      'autensa-backup-2026-04-05T10-11-12-v003.db',
    ]);
    expect(backups[0]?.migrationVersion).toBe('unknown');
    expect(backups[1]?.migrationVersion).toBe('004');
    expect(backups[2]?.migrationVersion).toBe('003');
  });

  it('restores a backup after creating a safety copy and removes stale sidecars', async () => {
    const cwd = prepareWorkspace('restore-backup');
    const dbPath = createDbFile(cwd, 'mission-control.db', 'current-db');
    const backupDir = path.join(cwd, 'db-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const filename = 'mc-backup-2026-04-05T10-11-13-v004.db';
    fs.writeFileSync(path.join(backupDir, filename), 'backup-db');
    fs.writeFileSync(dbPath + '-wal', 'wal');
    fs.writeFileSync(dbPath + '-shm', 'shm');

    mocks.dbPrepare.mockReturnValue({ get: mocks.dbGet });
    mocks.dbGet.mockReturnValue({ integrity_check: 'ok' });

    const result = await backupModule.restoreBackup(filename);

    expect(result.restored).toBe(filename);
    expect(result.safetyBackup.startsWith('pre-restore-')).toBe(true);
    expect(fs.existsSync(path.join(backupDir, result.safetyBackup))).toBe(true);
    expect(fs.existsSync(dbPath + '-wal')).toBe(false);
    expect(fs.existsSync(dbPath + '-shm')).toBe(false);
    expect(mocks.closeDb).toHaveBeenCalled();
    expect(mocks.dbClose).toHaveBeenCalled();
  });

  it('rejects invalid and missing backup filenames, then deletes local and legacy copies', async () => {
    const cwd = prepareWorkspace('delete-backup');
    const canonical = path.join(cwd, 'db-backups');
    const legacy = path.join(cwd, 'backups');
    fs.mkdirSync(canonical, { recursive: true });
    fs.mkdirSync(legacy, { recursive: true });
    const filename = 'mc-backup-2026-04-05T10-11-13-v004.db';
    fs.writeFileSync(path.join(canonical, filename), 'canonical');
    fs.writeFileSync(path.join(legacy, filename), 'legacy');

    await expect(backupModule.deleteBackup('../escape.db')).rejects.toThrow('Invalid backup filename');
    await expect(backupModule.deleteBackup('missing.db')).rejects.toThrow('Backup file not found: missing.db');

    await backupModule.deleteBackup(filename);

    expect(fs.existsSync(path.join(canonical, filename))).toBe(false);
    expect(fs.existsSync(path.join(legacy, filename))).toBe(false);
  });

  it('reports S3 configuration state and returns no remote backups when disabled', async () => {
    expect(backupModule.isS3Configured()).toBe(false);
    expect(backupModule.getS3Status()).toEqual({
      configured: false,
      endpoint: undefined,
      bucket: undefined,
    });
    expect(await backupModule.listS3Backups()).toEqual([]);

    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_BUCKET = 'mission-control';
    process.env.S3_ACCESS_KEY = 'access';
    process.env.S3_SECRET_KEY = 'secret';

    expect(backupModule.isS3Configured()).toBe(true);
    expect(backupModule.getS3Status()).toEqual({
      configured: true,
      endpoint: 'http://localhost:9000',
      bucket: 'mission-control',
    });
  });

  it('fails integrity verification when the restored database does not pass the check', async () => {
    const cwd = prepareWorkspace('restore-bad-integrity');
    createDbFile(cwd, 'mission-control.db', 'current-db');
    const backupDir = path.join(cwd, 'db-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const filename = 'mc-backup-2026-04-05T10-11-13-v004.db';
    fs.writeFileSync(path.join(backupDir, filename), 'backup-db');

    mocks.dbPrepare.mockReturnValue({ get: mocks.dbGet });
    mocks.dbGet.mockReturnValue({ integrity_check: 'mismatch' });

    await expect(backupModule.restoreBackup(filename)).rejects.toThrow('Database integrity check failed: mismatch');
  });
});
