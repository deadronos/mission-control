import { v4 as uuidv4 } from 'uuid';
import { getDb, queryOne, queryAll, run, transaction } from '@/lib/db';
import { endTaskSession } from '@/lib/openclaw/task-session-registry';
import type { Product } from '@/lib/types';

const PRODUCT_DEPENDENT_DELETES = [
  `DELETE FROM product_feedback WHERE product_id = ?`,
  `DELETE FROM content_inventory WHERE product_id = ?`,
  `DELETE FROM social_queue WHERE product_id = ?`,
  `DELETE FROM idea_suppressions WHERE product_id = ?`,
  `DELETE FROM swipe_history WHERE product_id = ?`,
  `DELETE FROM maybe_pool WHERE product_id = ?`,
  `DELETE FROM preference_models WHERE product_id = ?`,
  `DELETE FROM product_ab_tests WHERE product_id = ?`,
  `DELETE FROM product_skills WHERE product_id = ?`,
  `DELETE FROM product_health_scores WHERE product_id = ?`,
  `DELETE FROM product_schedules WHERE product_id = ?`,
  `DELETE FROM operations_log WHERE product_id = ?`,
  `DELETE FROM seo_keywords WHERE product_id = ?`,
  `DELETE FROM rollback_history WHERE product_id = ?`,
  `DELETE FROM cost_caps WHERE product_id = ?`,
  `DELETE FROM autopilot_activity_log WHERE product_id = ?`,
  `DELETE FROM idea_embeddings WHERE product_id = ?`,
  `DELETE FROM ideation_cycles WHERE product_id = ?`,
  `DELETE FROM cost_events WHERE product_id = ?`,
  `DELETE FROM ideas WHERE product_id = ?`,
  `DELETE FROM research_cycles WHERE product_id = ?`,
  `DELETE FROM product_program_variants WHERE product_id = ?`,
];

const PRODUCT_TASK_DEPENDENT_DELETES = [
  `DELETE FROM workspace_ports WHERE task_id IN (SELECT id FROM tasks WHERE product_id = ?)`,
  `DELETE FROM workspace_merges WHERE task_id IN (SELECT id FROM tasks WHERE product_id = ?)`,
  `DELETE FROM conversations WHERE task_id IN (SELECT id FROM tasks WHERE product_id = ?)`,
  `DELETE FROM events WHERE task_id IN (SELECT id FROM tasks WHERE product_id = ?)`,
  `DELETE FROM openclaw_sessions WHERE task_id IN (SELECT id FROM tasks WHERE product_id = ?)`,
  `DELETE FROM knowledge_entries WHERE task_id IN (SELECT id FROM tasks WHERE product_id = ?)`,
  `DELETE FROM agent_health WHERE task_id IN (SELECT id FROM tasks WHERE product_id = ?)`,
  `DELETE FROM cost_events WHERE task_id IN (SELECT id FROM tasks WHERE product_id = ?)`,
  `DELETE FROM tasks WHERE product_id = ?`,
];

function stopRunningProductTasks(productId: string, now: string): Set<string> {
  const runningTasks = queryAll<{ id: string; assigned_agent_id: string }>(
    `SELECT id, assigned_agent_id
     FROM tasks
     WHERE product_id = ?
       AND assigned_agent_id IS NOT NULL
       AND status IN ('assigned', 'in_progress', 'convoy_active', 'testing', 'verification')`,
    [productId]
  );

  const impactedAgents = new Set<string>();
  for (const task of runningTasks) {
    impactedAgents.add(task.assigned_agent_id);
    endTaskSession(getDb(), task.assigned_agent_id, task.id, now);
  }

  return impactedAgents;
}

function resetAgentStatusIfIdle(agentIds: Set<string>, now: string): void {
  for (const agentId of agentIds) {
    const remainingActive = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM tasks
       WHERE assigned_agent_id = ?
         AND status IN ('assigned', 'in_progress', 'convoy_active', 'testing', 'verification')`,
      [agentId]
    );

    if ((remainingActive?.count || 0) === 0) {
      run(
        `UPDATE agents SET status = 'standby', updated_at = ? WHERE id = ?`,
        [now, agentId]
      );
    }
  }
}

export function createProduct(input: {
  workspace_id?: string;
  name: string;
  description?: string;
  repo_url?: string;
  live_url?: string;
  product_program?: string;
  icon?: string;
  settings?: string;
  build_mode?: string;
  default_branch?: string;
}): Product {
  const id = uuidv4();
  const now = new Date().toISOString();
  const workspaceId = input.workspace_id || 'default';

  run(
    `INSERT INTO products (id, workspace_id, name, description, repo_url, live_url, product_program, icon, settings, build_mode, default_branch, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, workspaceId, input.name, input.description || null, input.repo_url || null, input.live_url || null, input.product_program || null, input.icon || '🚀', input.settings || null, input.build_mode || 'plan_first', input.default_branch || 'main', now, now]
  );

  const product = queryOne<Product>('SELECT * FROM products WHERE id = ?', [id])!;
  return product;
}

export function getProduct(id: string): Product | undefined {
  return queryOne<Product>('SELECT * FROM products WHERE id = ?', [id]);
}

export function listProducts(workspaceId?: string): Product[] {
  if (workspaceId) {
    return queryAll<Product>('SELECT * FROM products WHERE workspace_id = ? ORDER BY created_at DESC', [workspaceId]);
  }
  return queryAll<Product>('SELECT * FROM products ORDER BY created_at DESC');
}

export function updateProduct(id: string, updates: Partial<{
  name: string;
  description: string | null;
  repo_url: string | null;
  live_url: string | null;
  product_program: string;
  icon: string;
  status: string;
  settings: string;
  build_mode: string;
  default_branch: string;
  cost_cap_per_task: number | null;
  cost_cap_monthly: number | null;
  batch_review_threshold: number;
  max_parallel_agents: number | null;
}>): Product | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return getProduct(id);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  run(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values);
  return getProduct(id);
}

export function archiveProduct(id: string): boolean {
  const result = run(
    `UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), id]
  );
  return result.changes > 0;
}

export function hardDeleteProduct(id: string): boolean {
  if (!getProduct(id)) return false;

  return transaction(() => {
    const now = new Date().toISOString();
    const activeAgentIds = stopRunningProductTasks(id, now);

    const execDelete = (sql: string): void => {
      try {
        run(sql, [id]);
      } catch (error) {
        throw new Error(`[hardDeleteProduct] Failed on ${sql}: ${(error as Error).message}`);
      }
    };

    execDelete(`UPDATE tasks SET idea_id = NULL WHERE product_id = ?`);
    execDelete(`UPDATE ideas SET task_id = NULL WHERE product_id = ?`);

    for (const sql of PRODUCT_DEPENDENT_DELETES) {
      execDelete(sql);
    }

    for (const sql of PRODUCT_TASK_DEPENDENT_DELETES) {
      execDelete(sql);
    }

    const result = run(`DELETE FROM products WHERE id = ?`, [id]);
    if (result.changes > 0) {
      resetAgentStatusIfIdle(activeAgentIds, now);
    }
    return result.changes > 0;
  });
}
