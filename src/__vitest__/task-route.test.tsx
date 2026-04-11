import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { queryOne, run } from '@/lib/db';

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  drainQueue: vi.fn().mockResolvedValue(undefined),
  handleStageTransition: vi.fn(),
  populateTaskRolesFromAgents: vi.fn(),
  syncGatewayAgentsToCatalog: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/lib/events', () => ({
  broadcast: mocks.broadcast,
}));

vi.mock('@/lib/workflow-engine', () => ({
  handleStageTransition: mocks.handleStageTransition,
  drainQueue: mocks.drainQueue,
  populateTaskRolesFromAgents: mocks.populateTaskRolesFromAgents,
}));

vi.mock('@/lib/agent-catalog-sync', () => ({
  ensureCatalogSyncScheduled: vi.fn(),
  syncGatewayAgentsToCatalog: mocks.syncGatewayAgentsToCatalog,
}));

process.env.DATABASE_PATH = '.tmp/task-route-vitest.db';

function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.broadcast.mockReset();
  mocks.drainQueue.mockReset();
  mocks.drainQueue.mockResolvedValue(undefined);
  mocks.handleStageTransition.mockReset();
  mocks.populateTaskRolesFromAgents.mockReset();
  mocks.syncGatewayAgentsToCatalog.mockReset();
  mocks.syncGatewayAgentsToCatalog.mockResolvedValue(0);
});

describe('task api route', () => {
  it('returns 404 for a missing task', async () => {
    const { GET } = await import('@/app/api/tasks/[id]/route');
    const res = await GET(new NextRequest('http://localhost/api/tasks/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Task not found' });
  });

  it('returns an existing task on GET', async () => {
    const { POST } = await import('@/app/api/tasks/route');
    const { GET } = await import('@/app/api/tasks/[id]/route');

    const createdRes = await POST(jsonRequest('http://localhost/api/tasks', 'POST', {
      title: 'Readable task',
      workspace_id: 'default',
      business_id: 'default',
    }));
    expect(createdRes.status).toBe(201);
    const created = await createdRes.json();

    const res = await GET(new NextRequest(`http://localhost/api/tasks/${created.id}`), {
      params: Promise.resolve({ id: created.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.title).toBe('Readable task');
  });

  it('rejects invalid task creation payloads', async () => {
    const { POST } = await import('@/app/api/tasks/route');
    const res = await POST(jsonRequest('http://localhost/api/tasks', 'POST', {
      title: '',
      workspace_id: 'default',
      business_id: 'default',
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('creates a task and blocks done without evidence', async () => {
    const taskRoute = await import('@/app/api/tasks/route');
    const taskIdRoute = await import('@/app/api/tasks/[id]/route');

    const createdRes = await taskRoute.POST(jsonRequest('http://localhost/api/tasks', 'POST', {
      title: 'Route coverage task',
      workspace_id: 'default',
      business_id: 'default',
    }));
    expect(createdRes.status).toBe(201);
    const created = await createdRes.json();
    expect(created.status).toBe('inbox');
    expect(created.id).toBeTruthy();

    const doneRes = await taskIdRoute.PATCH(
      jsonRequest(`http://localhost/api/tasks/${created.id}`, 'PATCH', {
        status: 'done',
      }),
      { params: Promise.resolve({ id: created.id }) }
    );

    expect(doneRes.status).toBe(400);
    expect(await doneRes.json()).toEqual({
      error: 'Evidence gate failed: stage transition requires at least one deliverable and one activity note',
    });
  });

  it('rejects failing transitions without a status reason', async () => {
    const { PATCH } = await import('@/app/api/tasks/[id]/route');
    const taskId = crypto.randomUUID();

    run(
      `INSERT INTO tasks (id, title, status, priority, workspace_id, business_id, created_at, updated_at)
       VALUES (?, 'Stage failure task', 'review', 'normal', 'default', 'default', datetime('now'), datetime('now'))`,
      [taskId]
    );

    const res = await PATCH(
      jsonRequest(`http://localhost/api/tasks/${taskId}`, 'PATCH', {
        status: 'in_progress',
      }),
      { params: Promise.resolve({ id: taskId }) }
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'status_reason is required when failing a stage' });
  });

  it('forbids non-master agents from approving review tasks', async () => {
    const { PATCH } = await import('@/app/api/tasks/[id]/route');
    const taskId = crypto.randomUUID();
    const agentId = crypto.randomUUID();

    run(
      `INSERT INTO agents (id, name, role, status, is_master, workspace_id, source, created_at, updated_at)
       VALUES (?, 'Review Agent', 'reviewer', 'working', 0, 'default', 'local', datetime('now'), datetime('now'))`,
      [agentId]
    );
    run(
      `INSERT INTO tasks (id, title, status, priority, workspace_id, business_id, assigned_agent_id, created_at, updated_at)
       VALUES (?, 'Review gate task', 'review', 'normal', 'default', 'default', NULL, datetime('now'), datetime('now'))`,
      [taskId]
    );
    run(
      `INSERT INTO task_deliverables (id, task_id, deliverable_type, title, created_at)
       VALUES (lower(hex(randomblob(16))), ?, 'file', 'index.html', datetime('now'))`,
      [taskId]
    );
    run(
      `INSERT INTO task_activities (id, task_id, activity_type, message, created_at)
       VALUES (lower(hex(randomblob(16))), ?, 'completed', 'did thing', datetime('now'))`,
      [taskId]
    );

    const res = await PATCH(
      jsonRequest(`http://localhost/api/tasks/${taskId}`, 'PATCH', {
        status: 'done',
        updated_by_agent_id: agentId,
      }),
      { params: Promise.resolve({ id: taskId }) }
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Forbidden: only the master agent can approve tasks',
    });
  });

  it('bypasses the evidence gate when board override is enabled', async () => {
    const { PATCH } = await import('@/app/api/tasks/[id]/route');
    const original = process.env.BOARD_OVERRIDE_ENABLED;
    process.env.BOARD_OVERRIDE_ENABLED = 'true';

    try {
      const taskId = crypto.randomUUID();
      run(
        `INSERT INTO tasks (id, title, status, priority, workspace_id, business_id, created_at, updated_at)
         VALUES (?, 'Override task', 'review', 'normal', 'default', 'default', datetime('now'), datetime('now'))`,
        [taskId]
      );

      const res = await PATCH(
        new NextRequest(`http://localhost/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-mc-board-override': 'true',
          },
          body: JSON.stringify({
            status: 'done',
            board_override: true,
            override_reason: 'on-call override',
          }),
        }),
        { params: Promise.resolve({ id: taskId }) }
      );

      expect(res.status).toBe(200);
      const task = queryOne<{ status: string; status_reason: string | null }>(
        'SELECT status, status_reason FROM tasks WHERE id = ?',
        [taskId]
      );
      expect(task?.status).toBe('done');
      expect(task?.status_reason).toBeNull();

      const event = queryOne<{ message: string; metadata: string | null }>(
        `SELECT message, metadata FROM events WHERE task_id = ? AND type = 'system' ORDER BY created_at DESC LIMIT 1`,
        [taskId]
      );
      expect(event?.message).toContain('Board override: review → done');
      expect(event?.metadata).toContain('"boardOverride":true');
      expect(event?.metadata).toContain('"reason":"on-call override"');
    } finally {
      process.env.BOARD_OVERRIDE_ENABLED = original;
    }
  });
});
