import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMock,
}));

function setClientGlobals() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };

  (globalThis as any).window = { location: { origin: 'https://mission.example' } };
  (globalThis as any).localStorage = localStorage;

  return localStorage;
}

function clearClientGlobals() {
  delete (globalThis as any).window;
  delete (globalThis as any).localStorage;
}

async function loadConfigModule() {
  vi.resetModules();
  return import('@/lib/config');
}

beforeEach(() => {
  loggerMock.error.mockClear();
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
});

afterEach(() => {
  clearClientGlobals();
  vi.restoreAllMocks();
});

describe('config', () => {
  it('uses server-side environment values and path helpers', async () => {
    clearClientGlobals();
    const original = {
      OPENCLAW_HOME: process.env.OPENCLAW_HOME,
      WORKSPACE_BASE_PATH: process.env.WORKSPACE_BASE_PATH,
      PROJECTS_PATH: process.env.PROJECTS_PATH,
      MISSION_CONTROL_URL: process.env.MISSION_CONTROL_URL,
      HOME: process.env.HOME,
    };

    process.env.OPENCLAW_HOME = '/srv/openclaw';
    process.env.WORKSPACE_BASE_PATH = '/srv/workspaces';
    process.env.PROJECTS_PATH = '/srv/workspaces/projects';
    process.env.MISSION_CONTROL_URL = 'https://mission.local';
    process.env.HOME = '/srv/home';

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/srv/openclaw/projects/mission-control');

    try {
      const config = await loadConfigModule();

      expect(config.getWorkspaceBasePath()).toBe('/srv/workspaces');
      expect(config.getProjectsPath()).toBe('/srv/workspaces/projects');
      expect(config.getMissionControlUrl()).toBe('https://mission.local');
      expect(config.getProjectPath('alpha', 'deliverables')).toBe('/srv/workspaces/projects/alpha/deliverables');
      expect(config.expandPath('~/notes')).toBe('~/notes');
      expect(cwdSpy).toHaveBeenCalled();
    } finally {
      process.env.OPENCLAW_HOME = original.OPENCLAW_HOME;
      process.env.WORKSPACE_BASE_PATH = original.WORKSPACE_BASE_PATH;
      process.env.PROJECTS_PATH = original.PROJECTS_PATH;
      process.env.MISSION_CONTROL_URL = original.MISSION_CONTROL_URL;
      process.env.HOME = original.HOME;
    }
  });

  it('uses the openclaw root default when cwd is inside the workspace root', async () => {
    clearClientGlobals();
    const original = {
      OPENCLAW_HOME: process.env.OPENCLAW_HOME,
      WORKSPACE_BASE_PATH: process.env.WORKSPACE_BASE_PATH,
      PROJECTS_PATH: process.env.PROJECTS_PATH,
      MISSION_CONTROL_URL: process.env.MISSION_CONTROL_URL,
      HOME: process.env.HOME,
    };

    delete process.env.OPENCLAW_HOME;
    delete process.env.WORKSPACE_BASE_PATH;
    delete process.env.PROJECTS_PATH;
    delete process.env.MISSION_CONTROL_URL;
    process.env.HOME = '/Users/alice';

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/Users/alice/.openclaw/mission-control');

    try {
      const config = await loadConfigModule();

      expect(config.getWorkspaceBasePath()).toBe('~/.openclaw');
      expect(config.getProjectsPath()).toBe('~/.openclaw/projects');
      expect(config.getMissionControlUrl()).toBe('http://localhost:4000');
      expect(cwdSpy).toHaveBeenCalled();
    } finally {
      process.env.OPENCLAW_HOME = original.OPENCLAW_HOME;
      process.env.WORKSPACE_BASE_PATH = original.WORKSPACE_BASE_PATH;
      process.env.PROJECTS_PATH = original.PROJECTS_PATH;
      process.env.MISSION_CONTROL_URL = original.MISSION_CONTROL_URL;
      process.env.HOME = original.HOME;
    }
  });

  it('loads client config, updates values, and resets storage', async () => {
    const localStorage = setClientGlobals();
    const originalHome = process.env.HOME;
    process.env.HOME = '/Users/alice';

    try {
      localStorage.getItem.mockReturnValue(JSON.stringify({
        workspaceBasePath: '/workspaces',
        projectsPath: '/workspaces/projects',
        missionControlUrl: 'https://config.example',
        defaultProjectName: 'custom-project',
        kanbanCompactEmptyColumns: true,
      }));

      const config = await loadConfigModule();

      expect(config.getConfig()).toEqual(expect.objectContaining({
        workspaceBasePath: '/workspaces',
        projectsPath: '/workspaces/projects',
        missionControlUrl: 'https://config.example',
        defaultProjectName: 'custom-project',
        kanbanCompactEmptyColumns: true,
      }));
      expect(config.getMissionControlUrl()).toBe('https://config.example');
      expect(config.expandPath('~/docs')).toBe('/Users/alice/docs');

      config.updateConfig({
        workspaceBasePath: '/new-workspaces',
        missionControlUrl: 'https://updated.example',
      });

      expect(localStorage.setItem).toHaveBeenCalled();
      expect(JSON.parse(localStorage.setItem.mock.calls.at(-1)?.[1] as string)).toEqual(expect.objectContaining({
        workspaceBasePath: '/new-workspaces',
        missionControlUrl: 'https://updated.example',
      }));

      config.resetConfig();
      expect(localStorage.removeItem).toHaveBeenCalledWith('mission-control-config');
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it('falls back to defaults on malformed storage and rejects invalid updates', async () => {
    const localStorage = setClientGlobals();
    localStorage.getItem.mockReturnValueOnce('{not-json');

    const config = await loadConfigModule();

    expect(config.getConfig()).toEqual(expect.objectContaining({
      missionControlUrl: 'https://mission.example',
    }));
    expect(loggerMock.error).toHaveBeenCalled();

    expect(() => config.updateConfig({ workspaceBasePath: '   ' })).toThrow('Workspace base path cannot be empty');
    expect(() => config.updateConfig({ missionControlUrl: 'not-a-url' })).toThrow('Invalid Mission Control URL');

    localStorage.setItem.mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });

    expect(() => config.updateConfig({ defaultProjectName: 'alpha' })).toThrow('Failed to save configuration');
    expect(loggerMock.error).toHaveBeenCalled();
  });
});
