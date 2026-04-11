// @vitest-environment node
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST as createTask } from '@/app/api/tasks/route';
import { PATCH as updateTask, GET as getTask } from '@/app/api/tasks/[id]/route';
import { POST as addDeliverable } from '@/app/api/tasks/[id]/deliverables/route';
import { POST as addActivity } from '@/app/api/tasks/[id]/activities/route';
import { queryOne } from '@/lib/db';

function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('task lifecycle smoke test covers create, evidence logging, and completion', async () => {
  const createdRes = await createTask(jsonRequest('http://localhost/api/tasks', 'POST', {
    title: 'Smoke task',
    description: 'End-to-end lifecycle smoke test',
    workspace_id: 'default',
    business_id: 'default',
  }));

  assert.equal(createdRes.status, 201);
  const createdTask = await createdRes.json();
  const taskId = createdTask.id as string;
  assert.ok(taskId);
  assert.equal(createdTask.status, 'inbox');

  const activityRes = await addActivity(
    jsonRequest(`http://localhost/api/tasks/${taskId}/activities`, 'POST', {
      activity_type: 'completed',
      message: 'Smoke test activity',
    }),
    { params: Promise.resolve({ id: taskId }) }
  );
  assert.equal(activityRes.status, 201);

  const deliverableRes = await addDeliverable(
    jsonRequest(`http://localhost/api/tasks/${taskId}/deliverables`, 'POST', {
      deliverable_type: 'file',
      title: 'Smoke deliverable',
      path: '/tmp/smoke-task.html',
    }),
    { params: Promise.resolve({ id: taskId }) }
  );
  assert.equal(deliverableRes.status, 201);

  const doneRes = await updateTask(
    jsonRequest(`http://localhost/api/tasks/${taskId}`, 'PATCH', {
      status: 'done',
    }),
    { params: Promise.resolve({ id: taskId }) }
  );
  assert.equal(doneRes.status, 200);
  const doneTask = await doneRes.json();
  assert.equal(doneTask.status, 'done');

  const fetchedRes = await getTask(
    new NextRequest(`http://localhost/api/tasks/${taskId}`),
    { params: Promise.resolve({ id: taskId }) }
  );
  assert.equal(fetchedRes.status, 200);
  const fetchedTask = await fetchedRes.json();
  assert.equal(fetchedTask.status, 'done');

  const taskRow = queryOne<{ status: string }>('SELECT status FROM tasks WHERE id = ?', [taskId]);
  const deliverableCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM task_deliverables WHERE task_id = ?', [taskId]);
  const activityCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM task_activities WHERE task_id = ?', [taskId]);

  assert.equal(taskRow?.status, 'done');
  assert.equal(deliverableCount?.count, 1);
  assert.ok((activityCount?.count ?? 0) >= 1);
});
