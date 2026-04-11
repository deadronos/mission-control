import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanningTab } from '@/components/PlanningTab';
import { ConvoyTab } from '@/components/ConvoyTab';
import { WorkspaceTab } from '@/components/WorkspaceTab';

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const mocks = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  confirmMock: vi.fn(),
}));

function okResponse<T>(body: T, status = 200) {
  return {
    ok: true,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function errorResponse<T>(body: T, status = 500) {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  mocks.fetchMock.mockReset();
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = mocks.fetchMock as typeof fetch;
  mocks.confirmMock.mockReset();
  vi.spyOn(window, 'confirm').mockImplementation(mocks.confirmMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PlanningTab', () => {
  it('renders the completed planning view and retries dispatch', async () => {
    mocks.fetchMock.mockResolvedValueOnce(okResponse({
      taskId: 'task-complete',
      sessionKey: 'agent:main:planning:task-complete',
      messages: [
        { role: 'user', content: 'Please plan this', timestamp: 1 },
        { role: 'assistant', content: 'Question?', timestamp: 2 },
      ],
      currentQuestion: null,
      isComplete: true,
      dispatchError: 'Dispatch gateway is unavailable',
      spec: {
        title: 'Ship the feature',
        summary: 'A complete spec with explicit deliverables.',
        deliverables: ['UI implementation', 'Regression tests'],
        success_criteria: ['Feature ships cleanly'],
        constraints: {},
      },
      agents: [
        {
          name: 'Alpha',
          role: 'Lead agent',
          avatar_emoji: '🧭',
          soul_md: '',
          instructions: 'Lead the work.',
        },
      ],
      isStarted: true,
    }));

    render(<PlanningTab taskId="task-complete" />);

    expect(await screen.findByText('Planning Complete')).toBeInTheDocument();
    expect(screen.getByText('Ship the feature')).toBeInTheDocument();
    expect(screen.getByText('Regression tests')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry Dispatch/i }));

    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/tasks/task-complete/planning/retry-dispatch',
        { method: 'POST' }
      );
    });
  });

  it('starts planning and shows the waiting state', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce(okResponse({
        taskId: 'task-start',
        messages: [],
        isComplete: false,
        isStarted: false,
      }))
      .mockResolvedValueOnce(okResponse({
        success: true,
        sessionKey: 'agent:main:planning:task-start',
        messages: [
          { role: 'user', content: 'Planning request', timestamp: 1 },
        ],
        note: 'Planning started.',
      }));

    render(<PlanningTab taskId="task-start" />);

    expect(await screen.findByText('Start Planning')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Start Planning/i }));

    await waitFor(() => {
      expect(screen.getByText('Waiting for response...')).toBeInTheDocument();
    });
    expect(mocks.fetchMock).toHaveBeenCalledWith(
      '/api/tasks/task-start/planning',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('submits an answer with an Other response and enters waiting mode', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce(okResponse({
        taskId: 'task-answer',
        sessionKey: 'agent:main:planning:task-answer',
        messages: [
          { role: 'user', content: 'Start planning', timestamp: 1 },
        ],
        currentQuestion: {
          question: 'What do you need?',
          options: [
            { id: 'A', label: 'A design system' },
            { id: 'B', label: 'A data model' },
            { id: 'other', label: 'Other' },
          ],
        },
        isComplete: false,
        isStarted: true,
      }))
      .mockResolvedValueOnce(okResponse({
        success: true,
        note: 'Answer accepted',
      }));

    render(<PlanningTab taskId="task-answer" />);

    expect(await screen.findByText('What do you need?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Other').closest('button')!);
    fireEvent.change(screen.getByPlaceholderText('Please specify...'), {
      target: { value: 'A very specific deliverable' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    await waitFor(() => {
      expect(screen.getByText('Sending...')).toBeInTheDocument();
    });
    expect(JSON.parse((mocks.fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      answer: 'other',
      otherText: 'A very specific deliverable',
    });
  });

  it('cancels planning after confirmation and returns to the start screen', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce(okResponse({
        taskId: 'task-cancel',
        sessionKey: 'agent:main:planning:task-cancel',
        messages: [
          { role: 'user', content: 'Start planning', timestamp: 1 },
        ],
        currentQuestion: {
          question: 'Pick a direction',
          options: [
            { id: 'A', label: 'Option A' },
            { id: 'other', label: 'Other' },
          ],
        },
        isComplete: false,
        isStarted: true,
      }))
      .mockResolvedValueOnce(okResponse({
        success: true,
      }));

    mocks.confirmMock.mockReturnValue(true);

    render(<PlanningTab taskId="task-cancel" />);

    expect(await screen.findByText('Pick a direction')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    await waitFor(() => {
      expect(screen.getByText('Start Planning')).toBeInTheDocument();
    });

    expect(mocks.fetchMock).toHaveBeenCalledWith(
      '/api/tasks/task-cancel/planning',
      { method: 'DELETE' }
    );
  });
});

describe('ConvoyTab', () => {
  it('creates a convoy from manual subtasks and loads progress', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce(errorResponse({ error: 'No convoy found for this task' }, 404))
      .mockResolvedValueOnce(okResponse({ id: 'convoy-1' }, 201))
      .mockResolvedValueOnce(okResponse({
        id: 'convoy-1',
        parent_task_id: 'task-convoy-create',
        name: 'Build the feature',
        strategy: 'manual',
        status: 'active',
        total_subtasks: 2,
        completed_subtasks: 1,
        failed_subtasks: 0,
        subtasks: [
          {
            id: 'subtask-1',
            task_id: 'task-sub-1',
            title: 'Design',
            status: 'done',
            sort_order: 0,
            depends_on: [],
            task: {
              id: 'task-sub-1',
              title: 'Design',
              status: 'done',
              assigned_agent_id: null,
            },
          },
          {
            id: 'subtask-2',
            task_id: 'task-sub-2',
            title: 'Implement',
            status: 'in_progress',
            sort_order: 1,
            depends_on: ['task-sub-1'],
            task: {
              id: 'task-sub-2',
              title: 'Implement',
              status: 'in_progress',
              assigned_agent_id: null,
            },
          },
        ],
      }))
      .mockResolvedValueOnce(okResponse({
        convoy_id: 'convoy-1',
        status: 'active',
        total: 2,
        completed: 1,
        failed: 0,
        breakdown: { done: 1, in_progress: 1 },
        subtasks: [
          {
            id: 'subtask-1',
            task_id: 'task-sub-1',
            title: 'Design',
            status: 'done',
            assigned_agent_id: null,
            sort_order: 0,
            depends_on: [],
          },
          {
            id: 'subtask-2',
            task_id: 'task-sub-2',
            title: 'Implement',
            status: 'in_progress',
            assigned_agent_id: null,
            sort_order: 1,
            depends_on: ['task-sub-1'],
          },
        ],
      }));

    render(<ConvoyTab taskId="task-convoy-create" taskTitle="Build the feature" taskStatus="in_progress" />);

    expect(await screen.findByText(/Break this task into parallel sub-tasks/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Manual Decomposition/i }));
    fireEvent.change(screen.getByPlaceholderText('Sub-task 1 title'), {
      target: { value: 'Design' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Convoy' }));

    expect(await screen.findByText('Convoy')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 complete/i)).toBeInTheDocument();
    expect(screen.getAllByText('Implement')[0]).toBeInTheDocument();
    expect(screen.getByText(/Dependency Graph/i)).toBeInTheDocument();
  });

  it('handles dispatch, pause, resume, and expanded subtask details', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce(okResponse({
        id: 'convoy-2',
        parent_task_id: 'task-convoy-active',
        name: 'Ship the feature',
        strategy: 'manual',
        status: 'active',
        total_subtasks: 2,
        completed_subtasks: 1,
        failed_subtasks: 1,
        subtasks: [
          {
            id: 'subtask-a',
            task_id: 'task-a',
            title: 'Investigate',
            status: 'done',
            sort_order: 0,
            depends_on: [],
            task: {
              id: 'task-a',
              title: 'Investigate',
              status: 'done',
              assigned_agent_id: 'agent-1',
            },
          },
          {
            id: 'subtask-b',
            task_id: 'task-b',
            title: 'Implement',
            status: 'assigned',
            sort_order: 1,
            depends_on: ['task-a'],
            task: {
              id: 'task-b',
              title: 'Implement',
              status: 'assigned',
              assigned_agent_id: 'agent-2',
            },
          },
        ],
      }))
      .mockResolvedValueOnce(okResponse({
        convoy_id: 'convoy-2',
        status: 'active',
        total: 2,
        completed: 1,
        failed: 1,
        breakdown: { done: 1, assigned: 1 },
        subtasks: [
          {
            id: 'subtask-a',
            task_id: 'task-a',
            title: 'Investigate',
            status: 'done',
            assigned_agent_id: 'agent-1',
            sort_order: 0,
            depends_on: [],
          },
          {
            id: 'subtask-b',
            task_id: 'task-b',
            title: 'Implement',
            status: 'assigned',
            assigned_agent_id: 'agent-2',
            sort_order: 1,
            depends_on: ['task-a'],
          },
        ],
      }))
      .mockResolvedValueOnce(okResponse({ dispatched: 0 }))
      .mockResolvedValueOnce(okResponse({
        id: 'convoy-2',
        parent_task_id: 'task-convoy-active',
        name: 'Ship the feature',
        strategy: 'manual',
        status: 'active',
        total_subtasks: 2,
        completed_subtasks: 1,
        failed_subtasks: 1,
        subtasks: [
          {
            id: 'subtask-a',
            task_id: 'task-a',
            title: 'Investigate',
            status: 'done',
            sort_order: 0,
            depends_on: [],
            task: {
              id: 'task-a',
              title: 'Investigate',
              status: 'done',
              assigned_agent_id: 'agent-1',
            },
          },
          {
            id: 'subtask-b',
            task_id: 'task-b',
            title: 'Implement',
            status: 'assigned',
            sort_order: 1,
            depends_on: ['task-a'],
            task: {
              id: 'task-b',
              title: 'Implement',
              status: 'assigned',
              assigned_agent_id: 'agent-2',
            },
          },
        ],
      }))
      .mockResolvedValueOnce(okResponse({
        convoy_id: 'convoy-2',
        status: 'active',
        total: 2,
        completed: 1,
        failed: 1,
        breakdown: { done: 1, assigned: 1 },
        subtasks: [
          {
            id: 'subtask-a',
            task_id: 'task-a',
            title: 'Investigate',
            status: 'done',
            assigned_agent_id: 'agent-1',
            sort_order: 0,
            depends_on: [],
          },
          {
            id: 'subtask-b',
            task_id: 'task-b',
            title: 'Implement',
            status: 'assigned',
            assigned_agent_id: 'agent-2',
            sort_order: 1,
            depends_on: ['task-a'],
          },
        ],
      }))
      .mockResolvedValueOnce(okResponse({ status: 'paused' }))
      .mockResolvedValueOnce(okResponse({
        id: 'convoy-2',
        parent_task_id: 'task-convoy-active',
        name: 'Ship the feature',
        strategy: 'manual',
        status: 'paused',
        total_subtasks: 2,
        completed_subtasks: 1,
        failed_subtasks: 1,
        subtasks: [
          {
            id: 'subtask-a',
            task_id: 'task-a',
            title: 'Investigate',
            status: 'done',
            sort_order: 0,
            depends_on: [],
            task: {
              id: 'task-a',
              title: 'Investigate',
              status: 'done',
              assigned_agent_id: 'agent-1',
            },
          },
          {
            id: 'subtask-b',
            task_id: 'task-b',
            title: 'Implement',
            status: 'assigned',
            sort_order: 1,
            depends_on: ['task-a'],
            task: {
              id: 'task-b',
              title: 'Implement',
              status: 'assigned',
              assigned_agent_id: 'agent-2',
            },
          },
        ],
      }))
      .mockResolvedValueOnce(okResponse({
        convoy_id: 'convoy-2',
        status: 'paused',
        total: 2,
        completed: 1,
        failed: 1,
        breakdown: { done: 1, assigned: 1 },
        subtasks: [
          {
            id: 'subtask-a',
            task_id: 'task-a',
            title: 'Investigate',
            status: 'done',
            assigned_agent_id: 'agent-1',
            sort_order: 0,
            depends_on: [],
          },
          {
            id: 'subtask-b',
            task_id: 'task-b',
            title: 'Implement',
            status: 'assigned',
            assigned_agent_id: 'agent-2',
            sort_order: 1,
            depends_on: ['task-a'],
          },
        ],
      }))
      .mockResolvedValueOnce(okResponse({ status: 'active' }))
      .mockResolvedValueOnce(okResponse({
        id: 'convoy-2',
        parent_task_id: 'task-convoy-active',
        name: 'Ship the feature',
        strategy: 'manual',
        status: 'active',
        total_subtasks: 2,
        completed_subtasks: 1,
        failed_subtasks: 1,
        subtasks: [
          {
            id: 'subtask-a',
            task_id: 'task-a',
            title: 'Investigate',
            status: 'done',
            sort_order: 0,
            depends_on: [],
            task: {
              id: 'task-a',
              title: 'Investigate',
              status: 'done',
              assigned_agent_id: 'agent-1',
            },
          },
          {
            id: 'subtask-b',
            task_id: 'task-b',
            title: 'Implement',
            status: 'assigned',
            sort_order: 1,
            depends_on: ['task-a'],
            task: {
              id: 'task-b',
              title: 'Implement',
              status: 'assigned',
              assigned_agent_id: 'agent-2',
            },
          },
        ],
      }))
      .mockResolvedValueOnce(okResponse({
        convoy_id: 'convoy-2',
        status: 'active',
        total: 2,
        completed: 1,
        failed: 1,
        breakdown: { done: 1, assigned: 1 },
        subtasks: [
          {
            id: 'subtask-a',
            task_id: 'task-a',
            title: 'Investigate',
            status: 'done',
            assigned_agent_id: 'agent-1',
            sort_order: 0,
            depends_on: [],
          },
          {
            id: 'subtask-b',
            task_id: 'task-b',
            title: 'Implement',
            status: 'assigned',
            assigned_agent_id: 'agent-2',
            sort_order: 1,
            depends_on: ['task-a'],
          },
        ],
      }));

    render(<ConvoyTab taskId="task-convoy-active" taskTitle="Ship the feature" taskStatus="in_progress" />);

    expect(await screen.findByText('Convoy')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 complete/i)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Implement')[0]);
    expect(screen.getByText((_, element) => element?.textContent === 'Task ID: task-b')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === 'Depends on: task-a')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dispatch Ready' }));

    await waitFor(() => {
      expect(screen.getByText(/No sub-tasks ready for dispatch/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Pause convoy/i }));

    await waitFor(() => {
      expect(screen.getByText('PAUSED')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Resume convoy/i }));

    await waitFor(() => {
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    });
  });
});

describe('WorkspaceTab', () => {
  it('creates a workspace when none exists', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce(okResponse({ exists: false }))
      .mockResolvedValueOnce(okResponse({
        success: true,
        workspacePath: '/tmp/task-workspace',
        strategy: 'sandbox',
        branch: 'task-workspace',
        port: 4173,
        baseCommit: 'abcdef1234567890',
      }, 201))
      .mockResolvedValueOnce(okResponse({
        exists: true,
        strategy: 'sandbox',
        path: '/tmp/task-workspace',
        port: 4173,
        branch: 'task-workspace',
        baseBranch: 'main',
        baseCommit: 'abcdef1234567890',
        filesChanged: 2,
        insertions: 12,
        deletions: 3,
        mergeStatus: 'pending',
      }));

    render(<WorkspaceTab taskId="task-workspace-create" taskStatus="in_progress" />);

    expect(await screen.findByText(/No isolated workspace/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Create Workspace Manually/i }));

    await waitFor(() => {
      expect(screen.getByText(/Sandbox Copy/i)).toBeInTheDocument();
    });

    expect(screen.getByText('/tmp/task-workspace')).toBeInTheDocument();
    expect(screen.getByText('4173')).toBeInTheDocument();
  });

  it('merges and cleans up an existing workspace', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce(okResponse({
        exists: true,
        strategy: 'worktree',
        path: '/tmp/worktree-task',
        branch: 'autopilot/task-1',
        baseBranch: 'main',
        baseCommit: 'abcdef1234567890',
        filesChanged: 3,
        insertions: 10,
        deletions: 2,
        mergeStatus: 'conflict',
        conflicts: ['src/index.ts'],
      }))
      .mockResolvedValueOnce(okResponse({
        success: true,
        merged: true,
      }))
      .mockResolvedValueOnce(okResponse({
        exists: true,
        strategy: 'worktree',
        path: '/tmp/worktree-task',
        branch: 'autopilot/task-1',
        baseBranch: 'main',
        baseCommit: 'abcdef1234567890',
        filesChanged: 3,
        insertions: 10,
        deletions: 2,
        mergeStatus: 'merged',
      }))
      .mockResolvedValueOnce(okResponse({
        success: true,
      }))
      .mockResolvedValueOnce(okResponse({ exists: false }));

    mocks.confirmMock.mockReturnValue(true);

    render(<WorkspaceTab taskId="task-workspace-existing" taskStatus="done" />);

    expect(await screen.findByText(/Git Worktree/i)).toBeInTheDocument();
    expect(screen.getByText('/tmp/worktree-task')).toBeInTheDocument();
    expect(screen.getByText(/src\/index\.ts/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Merge/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/merged/i).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByTitle('Remove workspace'));

    await waitFor(() => {
      expect(screen.getByText(/No isolated workspace/i)).toBeInTheDocument();
    });
  });
});
