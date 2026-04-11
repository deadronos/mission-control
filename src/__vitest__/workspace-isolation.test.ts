import { afterAll, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';

import { queryOne, run } from '@/lib/db';
import { getPrimaryWorkspaceMetadataPath } from '@/lib/workspace-metadata';
import {
  acquireMergeLock,
  allocatePort,
  cleanupWorkspace,
  createTaskWorkspace,
  determineIsolationStrategy,
  getActiveWorkspaces,
  getWorkspaceStatus,
  mergeWorkspace,
  releaseMergeLock,
  releasePort,
  triggerWorkspaceMerge,
} from '@/lib/workspace-isolation';
import type { Task } from '@/lib/types';

const shared = vi.hoisted(() => ({ projectsPath: '' }));
vi.mock('@/lib/config', () => ({
  getProjectsPath: () => shared.projectsPath,
}));

const originalProjectsPath = process.env.PROJECTS_PATH;
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'mc-workspace-isolation-vitest-'));
const projectsPath = path.join(tempRoot, 'projects');
mkdirSync(projectsPath, { recursive: true });
process.env.PROJECTS_PATH = projectsPath;
shared.projectsPath = projectsPath;

afterAll(() => {
  process.env.PROJECTS_PATH = originalProjectsPath;
  rmSync(tempRoot, { recursive: true, force: true });
});

function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function initRepo(repoDir: string, fileName = 'README.md', initialContent = 'hello'): void {
  mkdirSync(repoDir, { recursive: true });
  execSync('git init -b main', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: repoDir, stdio: 'pipe' });
  writeFileSync(path.join(repoDir, fileName), initialContent);
  execSync(`git add "${fileName}"`, { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });
}

function seedWorkspaceTask(task: {
  id: string;
  title: string;
  status?: string;
  productId?: string | null;
  assignedAgentId?: string | null;
  repoUrl?: string | null;
  workspaceId?: string;
}): Task {
  run(
    `INSERT OR IGNORE INTO workspaces (id, name, slug)
     VALUES ('default', 'Default', 'default')`
  );
  if (task.productId) {
    run(
      `INSERT OR IGNORE INTO products (id, workspace_id, name)
       VALUES (?, 'default', ?)`,
      [task.productId, `${task.title} Product`]
    );
  }
  run(
    `INSERT INTO tasks (id, title, status, priority, workspace_id, business_id, product_id, assigned_agent_id, repo_url, repo_branch, created_at, updated_at)
     VALUES (?, ?, ?, 'normal', ?, 'default', ?, ?, ?, 'main', datetime('now'), datetime('now'))`,
    [
      task.id,
      task.title,
      task.status || 'inbox',
      task.workspaceId || 'default',
      task.productId || null,
      task.assignedAgentId || null,
      task.repoUrl || null,
    ]
  );

  return queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [task.id])!;
}

test('determineIsolationStrategy and merge locks follow the expected rules', () => {
  const repoTask = {
    id: randomUUID(),
    title: 'Repo-backed task',
    status: 'inbox',
    priority: 'normal',
    workspace_id: 'default',
    business_id: 'default',
    repo_url: 'https://example.com/repo.git',
  } as Task;

  assert.equal(determineIsolationStrategy(repoTask), 'worktree');
  assert.equal(determineIsolationStrategy({
    ...repoTask,
    id: randomUUID(),
    repo_url: undefined,
    product_id: randomUUID(),
  } as Task), null);

  const productId = randomUUID();
  const sibling = seedWorkspaceTask({
    id: randomUUID(),
    title: 'Sibling task',
    status: 'in_progress',
    productId,
  });
  const sandboxCandidate = seedWorkspaceTask({
    id: randomUUID(),
    title: 'Sandbox candidate',
    status: 'inbox',
    productId,
  });

  assert.equal(determineIsolationStrategy(sandboxCandidate), 'sandbox');
  assert.equal(determineIsolationStrategy({ ...sandboxCandidate, product_id: undefined } as Task), null);
  assert.equal(acquireMergeLock(productId), true);
  assert.equal(acquireMergeLock(productId), false);
  releaseMergeLock(productId);
  assert.equal(acquireMergeLock(productId), true);
  releaseMergeLock(productId);

  run('DELETE FROM tasks WHERE id IN (?, ?)', [sibling.id, sandboxCandidate.id]);
});

test('allocatePort picks the first free port and releasePort frees it again', () => {
  const taskOne = seedWorkspaceTask({
    id: randomUUID(),
    title: 'Port task one',
    status: 'assigned',
  });
  const taskTwo = seedWorkspaceTask({
    id: randomUUID(),
    title: 'Port task two',
    status: 'assigned',
  });

  run(
    `INSERT INTO workspace_ports (id, task_id, port, status, created_at)
     VALUES (lower(hex(randomblob(16))), ?, 4200, 'active', datetime('now'))`,
    [taskOne.id]
  );

  const nextPort = allocatePort(taskTwo.id);
  assert.equal(nextPort, 4201);

  releasePort(taskTwo.id);
  const released = queryOne<{ status: string }>(
    'SELECT status FROM workspace_ports WHERE task_id = ?',
    [taskTwo.id]
  );
  assert.equal(released?.status, 'released');

  run('DELETE FROM workspace_ports WHERE task_id IN (?, ?)', [taskOne.id, taskTwo.id]);
  run('DELETE FROM tasks WHERE id IN (?, ?)', [taskOne.id, taskTwo.id]);
});

test('sandbox workspaces can be created, inspected, merged, and cleaned up', async () => {
  const productId = randomUUID();
  const agentId = randomUUID();
  const baseTaskId = randomUUID();
  const taskId = randomUUID();
  const taskTitle = 'Sandbox task';
  const projectDir = path.join(projectsPath, slugifyTitle(taskTitle));

  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, 'index.txt'), 'original');

  run(
    `INSERT INTO agents (id, name, role, status, is_master, workspace_id, source, created_at, updated_at)
     VALUES (?, 'Sandbox Agent', 'builder', 'working', 0, 'default', 'local', datetime('now'), datetime('now'))`,
    [agentId]
  );
  seedWorkspaceTask({
    id: baseTaskId,
    title: 'Sandbox sibling',
    status: 'in_progress',
    productId,
  });
  const task = seedWorkspaceTask({
    id: taskId,
    title: taskTitle,
    status: 'in_progress',
    productId,
    assignedAgentId: agentId,
  });

  const workspace = await createTaskWorkspace(task);
  assert.equal(workspace.strategy, 'sandbox');
  assert.ok(workspace.path.includes('.workspaces/task-'));

  const workspaceFile = path.join(workspace.path, 'index.txt');
  assert.equal(readFileSync(workspaceFile, 'utf-8'), 'original');
  writeFileSync(workspaceFile, 'updated from sandbox');

  const status = await getWorkspaceStatus({
    ...task,
    workspace_path: workspace.path,
    workspace_strategy: 'sandbox',
    workspace_port: workspace.port,
    merge_status: 'pending',
  } as Task);
  assert.equal(status.exists, true);
  assert.equal(status.strategy, 'sandbox');
  assert.equal(status.filesChanged && status.filesChanged > 0, true);

  const active = getActiveWorkspaces(productId);
  assert.equal(active.length, 1);
  assert.equal(active[0].taskId, taskId);
  assert.equal(active[0].agentName, 'Sandbox Agent');

  const merge = await mergeWorkspace({
    ...task,
    workspace_path: workspace.path,
    workspace_strategy: 'sandbox',
    workspace_port: workspace.port,
    repo_branch: 'main',
    merge_status: 'pending',
  } as Task);
  assert.equal(merge.success, true);
  assert.equal(merge.status, 'merged');
  assert.equal(readFileSync(path.join(projectDir, 'index.txt'), 'utf-8'), 'updated from sandbox');

  const mergedTask = queryOne<{ merge_status: string | null }>('SELECT merge_status FROM tasks WHERE id = ?', [taskId]);
  assert.equal(mergedTask?.merge_status, 'merged');

  const mergeRecord = queryOne<{ status: string }>('SELECT status FROM workspace_merges WHERE task_id = ?', [taskId]);
  assert.equal(mergeRecord?.status, 'merged');

  assert.equal(cleanupWorkspace({
    ...task,
    workspace_path: workspace.path,
    workspace_strategy: 'sandbox',
    workspace_port: workspace.port,
  } as Task), true);

  const cleanedTask = queryOne<{ workspace_path: string | null; workspace_port: number | null }>(
    'SELECT workspace_path, workspace_port FROM tasks WHERE id = ?',
    [taskId]
  );
  assert.equal(cleanedTask?.workspace_path, null);
  assert.equal(cleanedTask?.workspace_port, null);

  const releasedPort = queryOne<{ status: string }>('SELECT status FROM workspace_ports WHERE task_id = ?', [taskId]);
  assert.equal(releasedPort?.status, 'released');

  assert.equal(existsSync(workspace.path), false);

  run('DELETE FROM workspace_ports WHERE task_id IN (?, ?)', [baseTaskId, taskId]);
  run('DELETE FROM workspace_merges WHERE task_id = ?', [taskId]);
  run('DELETE FROM tasks WHERE id IN (?, ?)', [baseTaskId, taskId]);
  run('DELETE FROM agents WHERE id = ?', [agentId]);
});

test('worktree workspaces can be created, inspected, merged, and cleaned up', async () => {
  const taskId = randomUUID();
  const title = 'Repo Task';
  const productId = randomUUID();
  const projectDir = path.join(projectsPath, slugifyTitle(title));
  initRepo(projectDir);
  const repoUrl = projectDir;

  const task = seedWorkspaceTask({
    id: taskId,
    title,
    status: 'in_progress',
    productId,
    repoUrl,
  });

  const workspace = await createTaskWorkspace(task);
  assert.equal(workspace.strategy, 'worktree');
  assert.ok(workspace.branch?.startsWith('autopilot/repo-task'));
  assert.ok(existsSync(workspace.path));

  const trackedFile = path.join(workspace.path, 'README.md');
  writeFileSync(trackedFile, 'updated in worktree');
  execSync('git add README.md', { cwd: workspace.path, stdio: 'pipe' });

  const status = await getWorkspaceStatus({
    ...task,
    workspace_path: workspace.path,
    workspace_strategy: 'worktree',
    workspace_port: workspace.port,
    merge_status: 'pending',
  } as Task);
  assert.equal(status.exists, true);
  assert.equal(status.strategy, 'worktree');
  assert.equal(status.branch, workspace.branch);
  assert.equal(status.filesChanged && status.filesChanged > 0, true);

  const active = getActiveWorkspaces(productId);
  assert.equal(active.length, 1);
  assert.equal(active[0].taskId, taskId);
  assert.equal(active[0].branch, workspace.branch);

  const merge = await mergeWorkspace({
    ...task,
    workspace_path: workspace.path,
    workspace_strategy: 'worktree',
    workspace_port: workspace.port,
    repo_branch: 'main',
    merge_status: 'pending',
    repo_url: repoUrl,
  } as Task);
  assert.equal(merge.success, true);
  assert.equal(merge.status, 'merged');
  assert.ok(merge.mergeCommit);

  const mergeRecord = queryOne<{ status: string }>('SELECT status FROM workspace_merges WHERE task_id = ?', [taskId]);
  assert.equal(mergeRecord?.status, 'merged');

  assert.equal(cleanupWorkspace({
    ...task,
    workspace_path: workspace.path,
    workspace_strategy: 'worktree',
    workspace_port: workspace.port,
  } as Task), true);

  const cleanedTask = queryOne<{ workspace_path: string | null; workspace_port: number | null }>(
    'SELECT workspace_path, workspace_port FROM tasks WHERE id = ?',
    [taskId]
  );
  assert.equal(cleanedTask?.workspace_path, null);
  assert.equal(cleanedTask?.workspace_port, null);
  assert.equal(existsSync(workspace.path), false);

  run('DELETE FROM workspace_ports WHERE task_id = ?', [taskId]);
  run('DELETE FROM workspace_merges WHERE task_id = ?', [taskId]);
  run('DELETE FROM tasks WHERE id = ?', [taskId]);
});

test('getPrimaryWorkspaceMetadataPath and triggerWorkspaceMerge handle simple cases', async () => {
  const workspacePath = path.join(tempRoot, 'meta-only-workspace');
  mkdirSync(workspacePath, { recursive: true });
  const metadataPath = getPrimaryWorkspaceMetadataPath(workspacePath);
  assert.equal(metadataPath, path.join(workspacePath, '.mc-workspace.json'));

  writeFileSync(
    metadataPath,
    JSON.stringify({ branch: 'autopilot/test-branch', taskId: 'task-x', status: 'active' }, null, 2)
  );
  assert.equal(await triggerWorkspaceMerge('missing-task'), null);
});
