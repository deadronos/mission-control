import test from 'node:test';
import assert from 'node:assert/strict';
import { createProduct, getProduct, hardDeleteProduct } from './products';
import { run, queryOne } from '@/lib/db';

test('hardDeleteProduct removes product subtree and task-linked rows', () => {
  run(`INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES ('default', 'Default Workspace', 'default')`);

  const product = createProduct({
    name: 'Delete Me',
    description: 'Temporary product for delete regression',
  });

  run(`INSERT INTO tasks (id, title, product_id, workspace_id, status) VALUES (?, ?, ?, 'default', 'in_progress')`, [
    'task-delete-1',
    'Task tied to product',
    product.id,
  ]);

  run(`INSERT INTO ideas (id, product_id, cycle_id, title, description, category, task_id, variant_id) VALUES (?, ?, NULL, ?, ?, 'feature', ?, NULL)`, [
    'idea-delete-1',
    product.id,
    'Delete regression idea',
    'An idea that should disappear with the product',
    'task-delete-1',
  ]);

  run(`INSERT INTO product_feedback (id, product_id, source, content, idea_id) VALUES (?, ?, 'email', 'Great idea', ?)`, [
    'feedback-delete-1',
    product.id,
    'idea-delete-1',
  ]);

  run(`INSERT INTO content_inventory (id, product_id, content_type, title, task_id, idea_id) VALUES (?, ?, 'blog_post', 'Content asset', ?, ?)`, [
    'content-delete-1',
    product.id,
    'task-delete-1',
    'idea-delete-1',
  ]);

  run(`INSERT INTO social_queue (id, product_id, platform, content, idea_id) VALUES (?, ?, 'twitter', 'Post copy', ?)`, [
    'social-delete-1',
    product.id,
    'idea-delete-1',
  ]);

  run(`INSERT INTO idea_suppressions (id, product_id, suppressed_title, suppressed_description, similar_to_idea_id, similarity_score, reason) VALUES (?, ?, 'Suppressed', 'Duplicate', ?, 0.94, 'dup')`, [
    'suppression-delete-1',
    product.id,
    'idea-delete-1',
  ]);

  run(`INSERT INTO product_program_variants (id, product_id, name, content, is_control) VALUES (?, ?, 'Control', 'Program text', 1)`, [
    'variant-delete-1',
    product.id,
  ]);

  run(`INSERT INTO product_ab_tests (id, product_id, variant_a_id, variant_b_id, status, split_mode, min_swipes) VALUES (?, ?, ?, ?, 'active', 'concurrent', 50)`, [
    'abtest-delete-1',
    product.id,
    'variant-delete-1',
    'variant-delete-1',
  ]);

  run(`INSERT INTO product_skills (id, product_id, skill_type, title, steps) VALUES (?, ?, 'fix', 'Skill', '1. Do the thing')`, [
    'skill-delete-1',
    product.id,
  ]);

  run(`INSERT INTO product_health_scores (id, product_id, overall_score, snapshot_date) VALUES (?, ?, 87, '2026-04-07')`, [
    'health-delete-1',
    product.id,
  ]);

  run(`INSERT INTO product_schedules (id, product_id, schedule_type, cron_expression) VALUES (?, ?, 'research', '0 9 * * *')`, [
    'schedule-delete-1',
    product.id,
  ]);

  run(`INSERT INTO operations_log (id, product_id, operation_type, status, created_at) VALUES (?, ?, 'content_publish', 'completed', ?)`, [
    'operation-delete-1',
    product.id,
    new Date().toISOString(),
  ]);

  run(`INSERT INTO seo_keywords (id, product_id, keyword) VALUES (?, ?, 'tetris game')`, [
    'keyword-delete-1',
    product.id,
  ]);

  run(`INSERT INTO rollback_history (id, product_id, trigger_type, trigger_details, merged_pr_url, merged_commit_sha, revert_pr_status, created_at) VALUES (?, ?, 'manual', 'cleanup', 'https://example.com/pr', 'deadbeef', 'pending', ?)`, [
    'rollback-delete-1',
    product.id,
    new Date().toISOString(),
  ]);

  run(`INSERT INTO cost_caps (id, workspace_id, product_id, cap_type, limit_usd) VALUES (?, 'default', ?, 'monthly', 100)`, [
    'cap-delete-1',
    product.id,
  ]);

  run(`INSERT INTO autopilot_activity_log (id, product_id, cycle_id, cycle_type, event_type, message, created_at) VALUES (?, ?, ?, 'research', 'started', 'Doing work', ?)`, [
    'activity-delete-1',
    product.id,
    'activity-cycle-1',
    new Date().toISOString(),
  ]);

  run(`INSERT INTO cost_events (id, product_id, workspace_id, task_id, cycle_id, event_type, cost_usd, created_at) VALUES (?, ?, 'default', ?, ?, 'build_task', 4.2, ?)`, [
    'cost-delete-1',
    product.id,
    'task-delete-1',
    null,
    new Date().toISOString(),
  ]);

  run(`INSERT INTO workspace_ports (id, task_id, port, product_id, status, created_at) VALUES (?, ?, 4201, ?, 'active', ?)`, [
    'port-delete-1',
    'task-delete-1',
    product.id,
    new Date().toISOString(),
  ]);

  run(`INSERT INTO workspace_merges (id, task_id, workspace_path, strategy, status, created_at) VALUES (?, ?, '/tmp/workspace', 'worktree', 'pending', ?)`, [
    'merge-delete-1',
    'task-delete-1',
    new Date().toISOString(),
  ]);

  run(`INSERT INTO conversations (id, task_id, title, type, created_at, updated_at) VALUES (?, ?, 'Task conversation', 'task', ?, ?)`, [
    'conversation-delete-1',
    'task-delete-1',
    new Date().toISOString(),
    new Date().toISOString(),
  ]);

  run(`INSERT INTO events (id, type, task_id, message, created_at) VALUES (?, 'task_update', ?, 'Task event', ?)`, [
    'event-delete-1',
    'task-delete-1',
    new Date().toISOString(),
  ]);

  run(`INSERT INTO openclaw_sessions (id, task_id, openclaw_session_id, channel, status, session_type, created_at, updated_at) VALUES (?, ?, 'session-1', 'test', 'active', 'persistent', ?, ?)`, [
    'session-delete-1',
    'task-delete-1',
    new Date().toISOString(),
    new Date().toISOString(),
  ]);

  run(`INSERT INTO knowledge_entries (id, workspace_id, task_id, category, title, content) VALUES (?, 'default', ?, 'notes', 'Knowledge', 'Notes')`, [
    'knowledge-delete-1',
    'task-delete-1',
  ]);

  run(`INSERT INTO agents (id, name, role, workspace_id, status) VALUES (?, 'Delete Agent', 'builder', 'default', 'standby')`, [
    'agent-delete-1',
  ]);

  run(`INSERT INTO agent_health (id, agent_id, task_id, health_state) VALUES (?, ?, ?, 'working')`, [
    'agent-health-delete-1',
    'agent-delete-1',
    'task-delete-1',
  ]);

  const deleted = hardDeleteProduct(product.id);
  assert.equal(deleted, true, 'hard delete should succeed');
  assert.equal(getProduct(product.id), undefined, 'product should be gone');

  const agent = queryOne<{ status: string }>('SELECT status FROM agents WHERE id = ?', ['agent-delete-1']);
  assert.equal(agent?.status, 'standby', 'running agent should be returned to standby');

  const checks = [
    ['ideas', 'SELECT COUNT(*) as c FROM ideas WHERE product_id = ?', [product.id]],
    ['product_feedback', 'SELECT COUNT(*) as c FROM product_feedback WHERE product_id = ?', [product.id]],
    ['content_inventory', 'SELECT COUNT(*) as c FROM content_inventory WHERE product_id = ?', [product.id]],
    ['product_ab_tests', 'SELECT COUNT(*) as c FROM product_ab_tests WHERE product_id = ?', [product.id]],
    ['product_program_variants', 'SELECT COUNT(*) as c FROM product_program_variants WHERE product_id = ?', [product.id]],
    ['cost_events', 'SELECT COUNT(*) as c FROM cost_events WHERE product_id = ?', [product.id]],
    ['tasks', 'SELECT COUNT(*) as c FROM tasks WHERE product_id = ?', [product.id]],
    ['workspace_ports', 'SELECT COUNT(*) as c FROM workspace_ports WHERE task_id = ?', ['task-delete-1']],
    ['workspace_merges', 'SELECT COUNT(*) as c FROM workspace_merges WHERE task_id = ?', ['task-delete-1']],
    ['conversations', 'SELECT COUNT(*) as c FROM conversations WHERE task_id = ?', ['task-delete-1']],
    ['events', 'SELECT COUNT(*) as c FROM events WHERE task_id = ?', ['task-delete-1']],
    ['openclaw_sessions', 'SELECT COUNT(*) as c FROM openclaw_sessions WHERE task_id = ?', ['task-delete-1']],
    ['knowledge_entries', 'SELECT COUNT(*) as c FROM knowledge_entries WHERE task_id = ?', ['task-delete-1']],
    ['agent_health', 'SELECT COUNT(*) as c FROM agent_health WHERE task_id = ?', ['task-delete-1']],
  ] as const;

  for (const [label, sql, params] of checks) {
    const row = queryOne<{ c: number }>(sql, params as unknown as any[]);
    assert.equal(row?.c, 0, `${label} rows should be removed`);
  }
});
