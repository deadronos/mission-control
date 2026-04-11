import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_PATH = ':memory:';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'mc-task-test-route-'));
const projectsPath = path.join(tempRoot, 'projects');
const homePath = path.join(tempRoot, 'home');
mkdirSync(projectsPath, { recursive: true });
mkdirSync(homePath, { recursive: true });
process.env.PROJECTS_PATH = projectsPath;
process.env.HOME = homePath;

const launchMock = vi.hoisted(() => vi.fn());
const parseMock = vi.hoisted(() => vi.fn((css: string, options?: { onParseError?: (error: { rawMessage?: string; message: string }) => void }) => {
  if (css.includes('color: }') || css.includes('broken-css')) {
    options?.onParseError?.({
      rawMessage: 'Unexpected token',
      message: 'Unexpected token',
    });
  }
}));

vi.mock('playwright', () => ({
  chromium: {
    launch: launchMock,
  },
}));

vi.mock('css-tree', () => ({
  parse: parseMock,
}));

let queryOne: typeof import('@/lib/db').queryOne;
let queryAll: typeof import('@/lib/db').queryAll;
let run: typeof import('@/lib/db').run;

beforeAll(async () => {
  const db = await import('@/lib/db');
  queryOne = db.queryOne;
  queryAll = db.queryAll;
  run = db.run;
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  launchMock.mockReset();
  launchMock.mockResolvedValue(createBrowserScenario({}).browser as any);
});

function readResponseJson(res: Response): Promise<any> {
  return res.text().then((text) => JSON.parse(text));
}

function seedTask(taskId: string, title: string, status = 'testing') {
  run(
    `INSERT OR IGNORE INTO workspaces (id, name, slug)
     VALUES ('default', 'Default', 'default')`
  );

  run(
    `INSERT INTO tasks (id, title, status, priority, workspace_id, business_id, created_at, updated_at)
     VALUES (?, ?, ?, 'normal', 'default', 'default', datetime('now'), datetime('now'))`,
    [taskId, title, status]
  );
}

function seedDeliverable(taskId: string, deliverable: {
  id: string;
  title: string;
  path: string;
  type: 'file' | 'url';
}) {
  run(
    `INSERT INTO task_deliverables (id, task_id, title, path, deliverable_type, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [deliverable.id, taskId, deliverable.title, deliverable.path, deliverable.type]
  );
}

function createBrowserScenario(opts: {
  status?: number;
  consoleErrors?: string[];
  consoleWarnings?: string[];
  pageErrors?: string[];
  resourceFailures?: Array<{ resourceType: string; url: string; errorText?: string }>;
  gotoThrows?: string;
}) {
  const listeners: Record<string, Array<(arg: any) => void>> = {};

  const page = {
    on(event: string, handler: (arg: any) => void) {
      listeners[event] ??= [];
      listeners[event].push(handler);
    },
    async goto() {
      if (opts.gotoThrows) {
        throw new Error(opts.gotoThrows);
      }

      for (const message of opts.consoleErrors || []) {
        for (const handler of listeners.console || []) {
          handler({
            type: () => 'error',
            text: () => message,
          });
        }
      }

      for (const message of opts.consoleWarnings || []) {
        for (const handler of listeners.console || []) {
          handler({
            type: () => 'warning',
            text: () => message,
          });
        }
      }

      for (const message of opts.pageErrors || []) {
        for (const handler of listeners.pageerror || []) {
          handler(new Error(message));
        }
      }

      for (const failure of opts.resourceFailures || []) {
        for (const handler of listeners.requestfailed || []) {
          handler({
            url: () => failure.url,
            failure: () => ({ errorText: failure.errorText || 'Request failed' }),
            resourceType: () => failure.resourceType,
          });
        }
      }

      return {
        status: () => opts.status ?? 200,
      };
    },
    async waitForTimeout() {
      return undefined;
    },
    async screenshot({ path: screenshotPath }: { path: string }) {
      writeFileSync(screenshotPath, 'shot');
    },
  };

  const context = {
    async newPage() {
      return page;
    },
    async close() {
      return undefined;
    },
  };

  return {
    browser: {
      async newContext() {
        return context;
      },
      async close() {
        return undefined;
      },
    },
  };
}

describe('GET /api/tasks/[id]/test route', () => {
  it('returns 404 for missing task', async () => {
    const route = await import('@/app/api/tasks/[id]/test/route');
    const res = await route.GET({} as any, { params: Promise.resolve({ id: 'missing-task' }) });
    const data = await readResponseJson(res as Response);

    expect(data.error).toBe('Task not found');
  });

  it('describes testable file and url deliverables for an existing task', async () => {
    const taskId = randomUUID();
    const htmlId = randomUUID();
    const htmId = randomUUID();
    const txtId = randomUUID();
    const urlId = randomUUID();
    const fileUrlId = randomUUID();
    const projectDir = path.join(projectsPath, 'route-task');
    mkdirSync(projectDir, { recursive: true });

    try {
      seedTask(taskId, 'Route task', 'testing');
      const htmlPath = path.join(projectDir, 'index.html');
      const htmPath = path.join(projectDir, 'preview.htm');
      const txtPath = path.join(projectDir, 'notes.txt');
      const fileUrlPath = path.join(projectDir, 'local-output.html');
      writeFileSync(htmlPath, '<html><body>ok</body></html>');
      writeFileSync(htmPath, '<html><body>ok</body></html>');
      writeFileSync(txtPath, 'skip me');
      writeFileSync(fileUrlPath, '<html><body>file url</body></html>');

      seedDeliverable(taskId, { id: htmlId, title: 'HTML', path: htmlPath, type: 'file' });
      seedDeliverable(taskId, { id: htmId, title: 'HTM', path: htmPath, type: 'file' });
      seedDeliverable(taskId, { id: txtId, title: 'Text', path: txtPath, type: 'file' });
      seedDeliverable(taskId, { id: urlId, title: 'Remote', path: 'https://example.com/app', type: 'url' });
      seedDeliverable(taskId, { id: fileUrlId, title: 'Local URL', path: fileUrlPath, type: 'url' });

      const route = await import('@/app/api/tasks/[id]/test/route');
      const res = await route.GET({} as any, { params: Promise.resolve({ id: taskId }) });
      const data = await readResponseJson(res as Response);

      expect(data.taskId).toBe(taskId);
      expect(data.deliverableCount).toBe(5);
      expect(data.testableFiles).toHaveLength(2);
      expect(data.testableUrls).toHaveLength(2);
      expect(data.testableFiles.map((entry: any) => entry.path)).toEqual([htmlPath, htmPath]);
      expect(data.testableUrls.map((entry: any) => entry.path)).toEqual(['https://example.com/app', fileUrlPath]);
    } finally {
      run('DELETE FROM task_deliverables WHERE task_id = ?', [taskId]);
      run('DELETE FROM tasks WHERE id = ?', [taskId]);
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/tasks/[id]/test route', () => {
  it('returns 400 when a task has no testable deliverables', async () => {
    const taskId = randomUUID();
    seedTask(taskId, 'No deliverables', 'testing');

    try {
      const route = await import('@/app/api/tasks/[id]/test/route');
      const res = await route.POST({} as any, { params: Promise.resolve({ id: taskId }) });
      const data = await readResponseJson(res as Response);

      expect(data.error).toBe('No testable deliverables found (file or url types)');
      expect(queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', [taskId])?.status).toBe('testing');
    } finally {
      run('DELETE FROM tasks WHERE id = ?', [taskId]);
    }
  });

  it('passes clean deliverables and moves the task to review', async () => {
    const taskId = randomUUID();
    const htmlId = randomUUID();
    const urlId = randomUUID();
    const projectDir = path.join(projectsPath, 'passing-task');
    mkdirSync(projectDir, { recursive: true });

    const browser = createBrowserScenario({
      status: 200,
      consoleWarnings: ['just a warning'],
    });
    launchMock.mockResolvedValue(browser.browser as any);

    try {
      seedTask(taskId, 'Passing task', 'testing');
      const htmlPath = path.join(projectDir, 'index.html');
      writeFileSync(htmlPath, '<!doctype html><html><head><style>body { color: blue; }</style></head><body>ok</body></html>');
      seedDeliverable(taskId, { id: htmlId, title: 'HTML', path: htmlPath, type: 'file' });
      seedDeliverable(taskId, { id: urlId, title: 'Remote', path: 'https://example.com/app', type: 'url' });

      const route = await import('@/app/api/tasks/[id]/test/route');
      const res = await route.POST({} as any, { params: Promise.resolve({ id: taskId }) });
      const data = await readResponseJson(res as Response);

      expect(data.passed).toBe(true);
      expect(data.newStatus).toBe('review');
      expect(data.results).toHaveLength(2);
      expect(data.summary).toContain('All 2 deliverable(s) passed');
      expect(queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', [taskId])?.status).toBe('review');
      expect(queryAll<{ activity_type: string }>('SELECT activity_type FROM task_activities WHERE task_id = ?', [taskId]).map((row) => row.activity_type)).toEqual(expect.arrayContaining(['test_passed', 'status_changed']));
    } finally {
      run('DELETE FROM task_deliverables WHERE task_id = ?', [taskId]);
      run('DELETE FROM task_activities WHERE task_id = ?', [taskId]);
      run('DELETE FROM tasks WHERE id = ?', [taskId]);
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('skips non-HTML file deliverables without launching the browser', async () => {
    const taskId = randomUUID();
    const txtId = randomUUID();
    const projectDir = path.join(projectsPath, 'skip-task');
    mkdirSync(projectDir, { recursive: true });

    try {
      seedTask(taskId, 'Skip task', 'testing');
      const txtPath = path.join(projectDir, 'notes.txt');
      writeFileSync(txtPath, 'plain text');
      seedDeliverable(taskId, { id: txtId, title: 'Notes', path: txtPath, type: 'file' });

      const route = await import('@/app/api/tasks/[id]/test/route');
      const res = await route.POST({} as any, { params: Promise.resolve({ id: taskId }) });
      const data = await readResponseJson(res as Response);

      expect(launchMock).toHaveBeenCalledTimes(1);
      expect(data.passed).toBe(true);
      expect(data.results[0].error).toBe('Skipped - not an HTML file');
      expect(data.newStatus).toBe('review');
    } finally {
      run('DELETE FROM task_deliverables WHERE task_id = ?', [taskId]);
      run('DELETE FROM task_activities WHERE task_id = ?', [taskId]);
      run('DELETE FROM tasks WHERE id = ?', [taskId]);
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('reports missing file and url deliverables immediately', async () => {
    const taskId = randomUUID();
    const fileId = randomUUID();
    const urlId = randomUUID();
    seedTask(taskId, 'Missing deliverables', 'testing');

    try {
      seedDeliverable(taskId, { id: fileId, title: 'Missing file', path: path.join(projectsPath, 'missing.html'), type: 'file' });
      seedDeliverable(taskId, { id: urlId, title: 'Missing url path', path: path.join(projectsPath, 'missing-url.html'), type: 'url' });

      const route = await import('@/app/api/tasks/[id]/test/route');

      const fileRes = await route.POST({} as any, { params: Promise.resolve({ id: taskId }) });
      const fileData = await readResponseJson(fileRes as Response);
      expect(fileData.passed).toBe(false);
      expect(fileData.results[0].error).toBe('File not found');
      expect(fileData.newStatus).toBe('assigned');

      run('DELETE FROM task_activities WHERE task_id = ?', [taskId]);
      run('DELETE FROM task_deliverables WHERE task_id = ?', [taskId]);
      seedDeliverable(taskId, { id: urlId, title: 'Missing url path', path: path.join(projectsPath, 'missing-url.html'), type: 'url' });

      const urlRes = await route.POST({} as any, { params: Promise.resolve({ id: taskId }) });
      const urlData = await readResponseJson(urlRes as Response);
      expect(urlData.passed).toBe(false);
      expect(urlData.results[0].error).toBe('Path not found');
    } finally {
      run('DELETE FROM task_deliverables WHERE task_id = ?', [taskId]);
      run('DELETE FROM task_activities WHERE task_id = ?', [taskId]);
      run('DELETE FROM tasks WHERE id = ?', [taskId]);
    }
  });

  it('surfaces CSS, console, resource, and HTTP failures from browser testing', async () => {
    const taskId = randomUUID();
    const htmlId = randomUUID();
    const urlId = randomUUID();
    const projectDir = path.join(projectsPath, 'failing-task');
    mkdirSync(projectDir, { recursive: true });

    const browser = createBrowserScenario({
      status: 500,
      consoleErrors: ['console boom'],
      consoleWarnings: ['console warning'],
      pageErrors: ['page exploded'],
      resourceFailures: [
        { resourceType: 'image', url: 'https://example.com/a.png', errorText: 'missing image' },
        { resourceType: 'script', url: 'https://example.com/a.js', errorText: 'missing script' },
        { resourceType: 'stylesheet', url: 'https://example.com/a.css', errorText: 'missing css' },
        { resourceType: 'document', url: 'https://example.com/', errorText: 'missing document' },
        { resourceType: 'fetch', url: 'https://example.com/api', errorText: 'missing other' },
      ],
    });
    launchMock.mockResolvedValue(browser.browser as any);

    try {
      seedTask(taskId, 'Failing task', 'testing');
      const htmlPath = path.join(projectDir, 'index.html');
      writeFileSync(htmlPath, '<!doctype html><html><head><style>body { color: }</style></head><body>broken</body></html>');
      seedDeliverable(taskId, { id: htmlId, title: 'Broken HTML', path: htmlPath, type: 'file' });
      seedDeliverable(taskId, { id: urlId, title: 'Broken HTTP', path: 'https://example.com/broken', type: 'url' });

      const route = await import('@/app/api/tasks/[id]/test/route');
      const res = await route.POST({} as any, { params: Promise.resolve({ id: taskId }) });
      const data = await readResponseJson(res as Response);

      expect(data.passed).toBe(false);
      expect(data.newStatus).toBe('assigned');
      expect(data.results).toHaveLength(2);
      expect(data.results[0].deliverable.type).toBe('file');
      expect(data.results[1].deliverable.type).toBe('url');
      expect(data.results[0].consoleErrors.some((message: string) => message.includes('console boom'))).toBe(true);
      expect(data.results[0].consoleWarnings).toContain('console warning');
      expect(new Set(data.results[0].resourceErrors.map((entry: any) => entry.type))).toEqual(new Set(['image', 'script', 'stylesheet', 'link', 'other']));
      expect(data.results[0].cssErrors.length).toBeGreaterThan(0);
      expect(data.results[1].httpStatus).toBe(500);
      expect(data.results[1].consoleErrors.some((message: string) => message.includes('HTTP error: Server returned status 500'))).toBe(true);
      expect(queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', [taskId])?.status).toBe('assigned');
    } finally {
      run('DELETE FROM task_deliverables WHERE task_id = ?', [taskId]);
      run('DELETE FROM task_activities WHERE task_id = ?', [taskId]);
      run('DELETE FROM tasks WHERE id = ?', [taskId]);
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('returns 500 when browser launch fails', async () => {
    const taskId = randomUUID();
    const htmlId = randomUUID();
    const projectDir = path.join(projectsPath, 'launch-fail-task');
    mkdirSync(projectDir, { recursive: true });

    launchMock.mockRejectedValueOnce(new Error('launch failed'));

    try {
      seedTask(taskId, 'Launch fail', 'testing');
      const htmlPath = path.join(projectDir, 'index.html');
      writeFileSync(htmlPath, '<html><body>ok</body></html>');
      seedDeliverable(taskId, { id: htmlId, title: 'HTML', path: htmlPath, type: 'file' });

      const route = await import('@/app/api/tasks/[id]/test/route');
      const res = await route.POST({} as any, { params: Promise.resolve({ id: taskId }) });
      const data = await readResponseJson(res as Response);

      expect(data.error).toBe('Internal server error');
      expect(queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', [taskId])?.status).toBe('testing');
    } finally {
      run('DELETE FROM task_deliverables WHERE task_id = ?', [taskId]);
      run('DELETE FROM task_activities WHERE task_id = ?', [taskId]);
      run('DELETE FROM tasks WHERE id = ?', [taskId]);
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
