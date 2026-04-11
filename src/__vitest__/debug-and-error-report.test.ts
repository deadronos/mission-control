import { afterEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMock,
}));

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    snapshot: () => Object.fromEntries(store.entries()),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  loggerMock.debug.mockReset();
});

describe('debug logging helpers', () => {
  it('logs on the server and honors client-side storage toggles', async () => {
    vi.stubGlobal('window', undefined as any);
    vi.stubGlobal('localStorage', undefined as any);
    const serverDebug = await import('@/lib/debug');
    serverDebug.debug.sse('server event', { id: 1 });
    expect(loggerMock.info).toHaveBeenCalledWith('[SSE] server event', { id: 1 });

    vi.resetModules();
    const storage = makeStorage();
    vi.stubGlobal('localStorage', storage as any);
    vi.stubGlobal('window', {
      location: { href: 'https://example.com/app' },
      mcDebug: undefined,
    } as any);

    const clientDebug = await import('@/lib/debug');
    clientDebug.debug.api('suppressed');
    expect(loggerMock.info).toHaveBeenCalledTimes(1);

    storage.setItem('AUTENSA_DEBUG', 'true');
    clientDebug.debug.store('enabled', { value: 1 });
    expect(loggerMock.info).toHaveBeenCalledWith('[STORE] enabled', { value: 1 });

    clientDebug.enableDebug();
    expect(storage.snapshot()).toEqual({ MC_DEBUG: 'true' });
    expect((window as any).mcDebug).toBeDefined();

    clientDebug.disableDebug();
    expect(storage.snapshot()).toEqual({});
    expect(loggerMock.info).toHaveBeenCalledWith('[DEBUG] Debug mode disabled.');
  });
});

describe('openErrorReport', () => {
  it('builds a mailto link from fetched logs, missing logs, and fetch failures', async () => {
    vi.stubGlobal('window', {
      location: { href: 'https://example.com/page' },
    } as any);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as any);

    const { openErrorReport } = await import('@/components/ErrorReportModal');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ logs: 'server logs' }),
    });
    await openErrorReport({
      errorType: 'Boom',
      errorMessage: 'Something broke',
      productId: 'prod-1',
      taskId: 'task-1',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/error-reports?productId=prod-1&taskId=task-1');
    expect(window.location.href).toContain('mailto:hello@mission-control.com');
    expect(window.location.href).toContain(encodeURIComponent('Issue: Boom — Something broke'));
    expect(window.location.href).toContain(encodeURIComponent('server logs'));

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ logs: 'ignored' }),
    });
    await openErrorReport({
      errorType: 'NoLogs',
      errorMessage: 'Short',
    });
    expect(window.location.href).toContain(encodeURIComponent('Error: NoLogs'));

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await openErrorReport({
      errorType: 'Offline',
      errorMessage: 'Brief',
    });
    expect(window.location.href).toContain(encodeURIComponent('(Could not fetch logs)'));

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ logs: 'x'.repeat(50) }),
    });
    await openErrorReport({
      errorType: 'Huge',
      errorMessage: 'x'.repeat(2000),
    });
    expect(window.location.href).toContain(encodeURIComponent('(Logs truncated — check Activity panel for full details)'));
  });
});
