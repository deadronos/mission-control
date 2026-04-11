import { afterEach, describe, expect, test, vi } from 'vitest';
import { run } from '@/lib/db';

const { broadcastMock } = vi.hoisted(() => ({ broadcastMock: vi.fn() }));

vi.mock('@/lib/events', () => ({
  broadcast: broadcastMock,
}));

describe('cost cap helpers', () => {
  const workspaceId = 'caps-workspace-1';
  const productId = 'caps-product-1';

  afterEach(() => {
    run('DELETE FROM cost_events WHERE workspace_id = ? OR product_id = ?', [workspaceId, productId]);
    run('DELETE FROM cost_caps WHERE workspace_id = ? OR product_id = ?', [workspaceId, productId]);
    run('DELETE FROM products WHERE id = ?', [productId]);
    broadcastMock.mockClear();
    vi.restoreAllMocks();
  });

  test('create, update, list, and delete cost caps', async () => {
    const { createCostCap, listCostCaps, updateCostCap, deleteCostCap } = await import('@/lib/costs/caps');

    run(`INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, 'Caps Workspace', 'caps-workspace')`, [workspaceId]);
    run(`INSERT INTO products (id, workspace_id, name, status, created_at, updated_at)
         VALUES (?, ?, 'Caps Product', 'active', datetime('now'), datetime('now'))`, [productId, workspaceId]);

    const cap = createCostCap({
      workspace_id: workspaceId,
      product_id: productId,
      cap_type: 'monthly',
      limit_usd: 100,
    });

    expect(cap.workspace_id).toBe(workspaceId);
    expect(cap.product_id).toBe(productId);

    const listed = listCostCaps(undefined, productId);
    expect(listed).toHaveLength(1);

    const updated = updateCostCap(cap.id, { limit_usd: 150, status: 'paused' });
    expect(updated?.limit_usd).toBe(150);
    expect(updated?.status).toBe('paused');

    expect(deleteCostCap(cap.id)).toBe(true);
    expect(listCostCaps(undefined, productId)).toHaveLength(0);
  });

  test('checkCaps warns at 80 percent and marks exceeded at 100 percent', async () => {
    const { createCostCap, checkCaps } = await import('@/lib/costs/caps');

    run(`INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES (?, 'Caps Workspace', 'caps-workspace')`, [workspaceId]);
    run(`INSERT INTO products (id, workspace_id, name, status, created_at, updated_at)
         VALUES (?, ?, 'Caps Product', 'active', datetime('now'), datetime('now'))`, [productId, workspaceId]);

    const monthCap = createCostCap({ workspace_id: workspaceId, cap_type: 'monthly', limit_usd: 10 });
    const productCap = createCostCap({
      workspace_id: workspaceId,
      product_id: productId,
      cap_type: 'per_product_monthly',
      limit_usd: 3,
    });

    const now = new Date().toISOString();
    run(
      'INSERT INTO cost_events (id, workspace_id, product_id, task_id, event_type, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['event-1', workspaceId, productId, null, 'build_task', 4, now]
    );
    run(
      'INSERT INTO cost_events (id, workspace_id, product_id, task_id, event_type, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['event-2', workspaceId, null, null, 'build_task', 4, now]
    );

    const result = checkCaps(workspaceId, productId);

    expect(result.ok).toBe(false);
    expect(result.warnings.map((cap) => cap.id)).toContain(monthCap.id);
    expect(result.exceeded.map((cap) => cap.id)).toContain(productCap.id);
    expect(broadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cost_cap_warning' })
    );
    expect(broadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cost_cap_exceeded' })
    );
  });
});
