import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const mockAddTask = vi.fn();
vi.mock('@/lib/store', () => ({
  useMissionControl: (selector: any) => selector({
    agents: [ { id: 'agent1', name: 'Agent A', role: 'builder', avatar_emoji: '' } ],
    addTask: mockAddTask,
    updateTask: vi.fn(),
    addEvent: vi.fn(),
  })
}));

const triggerAutoDispatchMock = vi.fn();
// Make the mock return a promise so code that calls .catch() is safe
triggerAutoDispatchMock.mockResolvedValue(undefined);
vi.mock('@/lib/auto-dispatch', () => ({ triggerAutoDispatch: triggerAutoDispatchMock, shouldTriggerAutoDispatch: vi.fn(() => false) }));

afterEach(() => {
  cleanup();
});

describe('TaskModal assign & auto-dispatch', () => {
  it('triggers auto-dispatch when a new task is saved with an agent assigned', async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 't1', title: 'New Task', assigned_agent_id: 'agent1', status: 'assigned', workspace_id: 'default' }) });

    const onClose = vi.fn();
    const TaskModalModule = await import('@/components/TaskModal');
    const TaskModal = (TaskModalModule as any).TaskModal || (TaskModalModule as any).default || (TaskModalModule as any);

    render(<TaskModal onClose={onClose} />);

    const [titleInput] = screen.getAllByPlaceholderText('What needs to be done?');
    fireEvent.change(titleInput, { target: { value: 'My Task' } });

    const selects = screen.getAllByRole('combobox');
    const assignSelect = selects.find(s => Array.from((s as HTMLSelectElement).options).some(opt => opt.value === 'agent1' || String(opt.text).includes('Agent A')));
    if (!assignSelect) throw new Error('assign select not found');
    fireEvent.change(assignSelect as HTMLElement, { target: { value: 'agent1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockAddTask).toHaveBeenCalled();
    expect(triggerAutoDispatchMock).toHaveBeenCalled();
  }, 15000);
});
