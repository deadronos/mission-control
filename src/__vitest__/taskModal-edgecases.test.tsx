import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const mocks = vi.hoisted(() => ({
  addTask: vi.fn(),
  updateTask: vi.fn(),
  addEvent: vi.fn(),
  triggerAutoDispatch: vi.fn().mockResolvedValue(undefined),
  shouldTriggerAutoDispatch: vi.fn(() => false),
  fetchMock: vi.fn(),
}));

vi.mock('@/lib/store', () => ({
  useMissionControl: (selector: any) => selector({
    agents: [],
    addTask: mocks.addTask,
    updateTask: mocks.updateTask,
    addEvent: mocks.addEvent,
  }),
}));

vi.mock('@/lib/auto-dispatch', () => ({
  triggerAutoDispatch: mocks.triggerAutoDispatch,
  shouldTriggerAutoDispatch: mocks.shouldTriggerAutoDispatch,
}));

beforeEach(() => {
  mocks.addTask.mockReset();
  mocks.updateTask.mockReset();
  mocks.addEvent.mockReset();
  mocks.fetchMock.mockReset();
  mocks.triggerAutoDispatch.mockClear();
  mocks.shouldTriggerAutoDispatch.mockClear();
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = mocks.fetchMock as typeof fetch;
});

afterEach(() => {
  cleanup();
});

describe('TaskModal edge cases', () => {
  it('renders validation details when the server rejects a save', async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        error: 'Validation failed',
        details: [{ message: 'Title is required' }],
      }),
    });

    const onClose = vi.fn();
    const { TaskModal } = await import('@/components/TaskModal');

    render(<TaskModal onClose={onClose} />);

    const [titleInput] = screen.getAllByPlaceholderText('What needs to be done?');
    fireEvent.change(titleInput, {
      target: { value: 'My task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Could not save task/i)).toBeInTheDocument();
    expect(screen.getByText(/Validation failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Title is required/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  }, 15000);

  it('creates a planning task and starts planning mode', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'task-planning',
          title: 'Plan a launch',
          status: 'planning',
          assigned_agent_id: null,
          workspace_id: 'default',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      });

    const onClose = vi.fn();
    const { TaskModal } = await import('@/components/TaskModal');

    render(<TaskModal onClose={onClose} />);

    const [titleInput] = screen.getAllByPlaceholderText('What needs to be done?');
    fireEvent.change(titleInput, {
      target: { value: 'Plan a launch' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Planning Mode/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(mocks.fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/tasks',
      expect.objectContaining({ method: 'POST' })
    );

    const firstPayload = JSON.parse((mocks.fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(firstPayload.status).toBe('planning');

    expect(mocks.fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/tasks/task-planning/planning',
      { method: 'POST' }
    );
  }, 15000);
});
