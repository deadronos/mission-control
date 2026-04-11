import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Mock next/navigation's useRouter
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const mockAddTask = vi.fn();
const mockAddEvent = vi.fn();

// Mock useMissionControl to apply selector on a fake store
vi.mock('@/lib/store', () => ({
  useMissionControl: (selector: any) => selector({
    agents: [],
    addTask: mockAddTask,
    updateTask: vi.fn(),
    addEvent: mockAddEvent,
  })
}));

beforeEach(() => {
  mockAddTask.mockReset();
  mockAddEvent.mockReset();
  // stub fetch
  (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 't1', title: 'New Task', assigned_agent_id: null, status: 'inbox' }) });
});

afterEach(() => {
  cleanup();
});

describe('TaskModal (create flow)', () => {
  it('saves a new task and calls onClose', async () => {
    const onClose = vi.fn();
    const TaskModalModule = await import('@/components/TaskModal');
    const TaskModal = (TaskModalModule as any).TaskModal || (TaskModalModule as any).default || (TaskModalModule as any);

    render(<TaskModal onClose={onClose} />);

    const [input] = screen.getAllByPlaceholderText('What needs to be done?');
    fireEvent.change(input, { target: { value: 'My Test Task' } });

    const saveBtn = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockAddTask).toHaveBeenCalled();
  }, 15000);
});
