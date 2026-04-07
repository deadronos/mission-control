import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { queryOne, run } from './db';
import { OpenClawClient } from './openclaw/client';
import { syncGatewayAgentsToCatalog } from './agent-catalog-sync';

test('agent catalog sync preserves locally curated non-default roles', async () => {
  const originalIsConnected = OpenClawClient.prototype.isConnected;
  const originalConnect = OpenClawClient.prototype.connect;
  const originalListAgents = OpenClawClient.prototype.listAgents;

  const preserveGatewayId = `gw-preserve-${randomUUID()}`;
  const updateGatewayId = `gw-update-${randomUUID()}`;
  const insertGatewayId = `gw-insert-${randomUUID()}`;
  const preserveAgentId = `agent-preserve-${randomUUID()}`;
  const updateAgentId = `agent-update-${randomUUID()}`;
  const syncReason = `test-role-preserve-${randomUUID()}`;
  const now = new Date().toISOString();

  try {
    run(
      `INSERT OR IGNORE INTO workspaces (id, name, slug)
       VALUES ('default', 'Default', 'default')`
    );

    run(
      `INSERT INTO agents (
         id, name, role, description, avatar_emoji, status, is_master, workspace_id,
         model, source, gateway_agent_id, session_key_prefix, total_cost_usd, total_tokens_used,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, '🤖', 'standby', 0, 'default', ?, 'gateway', ?, NULL, 0, 0, ?, ?)`,
      [
        preserveAgentId,
        'Local Designer',
        'designer',
        'Locally curated role should survive sync',
        'model-alpha',
        preserveGatewayId,
        now,
        now,
      ]
    );

    run(
      `INSERT INTO agents (
         id, name, role, description, avatar_emoji, status, is_master, workspace_id,
         model, source, gateway_agent_id, session_key_prefix, total_cost_usd, total_tokens_used,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, '🤖', 'standby', 0, 'default', ?, 'gateway', ?, NULL, 0, 0, ?, ?)`,
      [
        updateAgentId,
        'Local Builder',
        'builder',
        'Default role should be refreshed from gateway sync',
        'model-beta',
        updateGatewayId,
        now,
        now,
      ]
    );

    OpenClawClient.prototype.isConnected = function isConnected() {
      return true;
    };

    OpenClawClient.prototype.connect = async function connect() {
      return undefined;
    };

    OpenClawClient.prototype.listAgents = async function listAgents() {
      return [
        { id: preserveGatewayId, name: 'Gateway Reviewer', model: 'model-gamma' },
        { id: updateGatewayId, name: 'Gateway Tester', model: 'model-delta' },
        { id: insertGatewayId, name: 'Gateway Planner', model: 'model-epsilon' },
      ];
    };

    const changed = await syncGatewayAgentsToCatalog({ force: true, reason: syncReason });

    assert.equal(changed, 3);

    const preserved = queryOne<{ role: string; source: string; session_key_prefix: string | null; model: string | null }>(
      'SELECT role, source, session_key_prefix, model FROM agents WHERE gateway_agent_id = ?',
      [preserveGatewayId]
    );
    assert.ok(preserved);
    assert.equal(preserved?.role, 'designer');
    assert.equal(preserved?.source, 'gateway');
    assert.equal(preserved?.model, 'model-gamma');

    const refreshed = queryOne<{ role: string; source: string; session_key_prefix: string | null; model: string | null }>(
      'SELECT role, source, session_key_prefix, model FROM agents WHERE gateway_agent_id = ?',
      [updateGatewayId]
    );
    assert.ok(refreshed);
    assert.equal(refreshed?.role, 'tester');
    assert.equal(refreshed?.source, 'gateway');
    assert.equal(refreshed?.model, 'model-delta');

    const inserted = queryOne<{ role: string; gateway_agent_id: string; source: string; model: string | null }>(
      'SELECT role, gateway_agent_id, source, model FROM agents WHERE gateway_agent_id = ?',
      [insertGatewayId]
    );
    assert.ok(inserted);
    assert.equal(inserted?.role, 'orchestrator');
    assert.equal(inserted?.gateway_agent_id, insertGatewayId);
    assert.equal(inserted?.source, 'gateway');
    assert.equal(inserted?.model, 'model-epsilon');

    const event = queryOne<{ message: string; metadata: string | null }>(
      'SELECT message, metadata FROM events WHERE message = ?',
      [`Agent catalog sync completed (${syncReason})`]
    );
    assert.ok(event);
    assert.match(event?.metadata ?? '', /"reason":"test-role-preserve-/);
  } finally {
    OpenClawClient.prototype.isConnected = originalIsConnected;
    OpenClawClient.prototype.connect = originalConnect;
    OpenClawClient.prototype.listAgents = originalListAgents;

    run('DELETE FROM events WHERE message = ?', [`Agent catalog sync completed (${syncReason})`]);
    run('DELETE FROM agents WHERE gateway_agent_id IN (?, ?, ?)', [
      preserveGatewayId,
      updateGatewayId,
      insertGatewayId,
    ]);
  }
});