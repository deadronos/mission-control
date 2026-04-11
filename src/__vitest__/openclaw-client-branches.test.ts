import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const identityMock = vi.hoisted(() => ({
  loadOrCreateDeviceIdentity: vi.fn(() => ({
    deviceId: 'device-123',
    publicKeyPem: 'public-key',
    privateKeyPem: 'private-key',
  })),
  signDevicePayload: vi.fn(() => 'signature'),
  buildDeviceAuthPayload: vi.fn(() => ({
    deviceId: 'device-123',
    signature: 'signature',
    nonce: 'nonce',
  })),
}));

const compatMock = vi.hoisted(() => ({
  extractGatewayAgents: vi.fn((result) => (Array.isArray(result) ? result : [])),
  extractGatewaySessions: vi.fn((result) => (Array.isArray(result) ? result : [])),
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMock,
}));

vi.mock('@/lib/openclaw/device-identity', () => identityMock);
vi.mock('@/lib/openclaw/gateway-compat', () => compatMock);

vi.stubGlobal('WebSocket', {
  OPEN: 1,
  CONNECTING: 0,
} as any);

let OpenClawClient: typeof import('@/lib/openclaw/client').OpenClawClient;

beforeAll(async () => {
  ({ OpenClawClient } = await import('@/lib/openclaw/client'));
});

afterEach(() => {
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  loggerMock.debug.mockReset();
  identityMock.loadOrCreateDeviceIdentity.mockClear();
  identityMock.signDevicePayload.mockClear();
  identityMock.buildDeviceAuthPayload.mockClear();
  compatMock.extractGatewayAgents.mockClear();
  compatMock.extractGatewaySessions.mockClear();
});

describe('OpenClawClient branches', () => {
  it('covers message handling, event ids, and response helpers', async () => {
    const client = new OpenClawClient('ws://example.test', 'token');
    const anyClient = client as any;

    await expect(anyClient.call('sessions.list')).rejects.toThrow('Not connected to OpenClaw Gateway');
    expect(client.isConnected()).toBe(false);

    expect(anyClient.generateEventId({ id: 'evt_custom' })).toBe('evt_custom');
    expect(anyClient.generateEventId({ type: 'alpha', event: 'beta', seq: 7, timestamp: '123' })).toHaveLength(32);

    const resolved: unknown[] = [];
    const rejected: string[] = [];
    anyClient.pendingRequests = new Map([
      ['res-ok', { resolve: (value: unknown) => resolved.push(value), reject: (error: Error) => rejected.push(error.message) }],
      ['res-bad', { resolve: (value: unknown) => resolved.push(value), reject: (error: Error) => rejected.push(error.message) }],
      ['legacy-ok', { resolve: (value: unknown) => resolved.push(value), reject: (error: Error) => rejected.push(error.message) }],
      ['legacy-bad', { resolve: (value: unknown) => resolved.push(value), reject: (error: Error) => rejected.push(error.message) }],
    ]);

    const notifications: Array<{ method: string; params?: unknown }> = [];
    const customEvents: unknown[] = [];
    client.on('notification', (event) => notifications.push(event as { method: string; params: unknown }));
    client.on('custom.event', (params) => customEvents.push(params));

    anyClient.handleMessage({ type: 'res', id: 'res-ok', ok: true, payload: { ok: true } });
    anyClient.handleMessage({ type: 'res', id: 'res-bad', ok: false, error: { message: 'boom' } });
    anyClient.handleMessage({ id: 'legacy-ok', result: ['legacy'] });
    anyClient.handleMessage({ id: 'legacy-bad', error: { message: 'legacy boom' } });
    anyClient.handleMessage({ method: 'custom.event', params: { count: 2 } });

    expect(resolved).toEqual([{ ok: true }, ['legacy']]);
    expect(rejected).toEqual(['boom', 'legacy boom']);
    expect(notifications).toEqual([{ method: 'custom.event', params: { count: 2 } }]);
    expect(customEvents).toEqual([{ count: 2 }]);

    anyClient.connected = true;
    anyClient.authenticated = true;
    anyClient.ws = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
    };
    expect(client.isConnected()).toBe(true);

    anyClient.call = vi.fn().mockResolvedValueOnce({ models: [{ id: 'm1', name: 'Model', provider: 'acme' }] });
    expect(await client.listModels()).toEqual([{ id: 'm1', name: 'Model', provider: 'acme' }]);
    anyClient.call = vi.fn().mockResolvedValueOnce({ models: 'nope' });
    expect(await client.listModels()).toEqual([]);

    anyClient.call = vi.fn().mockResolvedValueOnce({ config: { agents: { defaults: { model: { primary: 'gpt-5' } } } } });
    expect(await client.getConfig()).toEqual({ config: { agents: { defaults: { model: { primary: 'gpt-5' } } } } });
    anyClient.call = vi.fn().mockResolvedValueOnce(null);
    expect(await client.getConfig()).toEqual({});

    anyClient.call = vi.fn().mockResolvedValueOnce([{ id: 's1' }]);
    expect(await client.listSessions()).toEqual([{ id: 's1' }]);
    anyClient.call = vi.fn().mockResolvedValueOnce([{ id: 'a1' }]);
    expect(await client.listAgents()).toEqual([{ id: 'a1' }]);

    const closeMock = vi.fn();
    anyClient.pendingRequests = new Map([
      ['drop', { resolve: vi.fn(), reject: vi.fn() }],
    ]);
    anyClient.ws = {
      readyState: 1,
      send: vi.fn(),
      close: closeMock,
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
    };
    anyClient.forceReconnect();
    expect(closeMock).toHaveBeenCalled();
    expect(anyClient.pendingRequests.size).toBe(0);
    expect(client.isConnected()).toBe(false);

    const timer = setTimeout(() => undefined, 1000);
    anyClient.reconnectTimer = timer;
    client.setAutoReconnect(false);
    expect(anyClient.reconnectTimer).toBeNull();

    anyClient.ws = {
      readyState: 1,
      send: vi.fn(),
      close: closeMock,
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
    };
    anyClient.pendingRequests = new Map([
      ['disconnect', { resolve: vi.fn(), reject: vi.fn() }],
    ]);
    client.disconnect();
    expect(closeMock).toHaveBeenCalled();
    expect(anyClient.pendingRequests.size).toBe(0);
  });
});
