import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const addAgent = vi.fn();
  const updateAgent = vi.fn();
  const state: { agents: any[]; addAgent: typeof addAgent; updateAgent: typeof updateAgent } = {
    agents: [],
    addAgent,
    updateAgent,
  };

  const setState = vi.fn((updater: any) => {
    const next = typeof updater === 'function' ? updater(state) : updater;
    Object.assign(state, next);
  });

  return {
    state,
    addAgent,
    updateAgent,
    setState,
  };
});

vi.mock('@/lib/store', () => ({
  useMissionControl: Object.assign((selector?: any) => (selector ? selector(mocks.state) : mocks.state), {
    setState: mocks.setState,
  }),
}));

beforeEach(() => {
  mocks.state.agents = [];
  mocks.addAgent.mockReset();
  mocks.updateAgent.mockReset();
  mocks.setState.mockClear();
  (globalThis as typeof globalThis & {
    fetch: typeof fetch;
    confirm: typeof confirm;
  }).fetch = vi.fn();
  (globalThis as typeof globalThis & { confirm: typeof confirm }).confirm = vi.fn(() => true);
});

afterEach(() => {
  cleanup();
});

describe('TeamTab', () => {
  it('loads workflows, fills missing roles, and saves role assignments', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            role: 'Engineer',
            agent_id: 'agent-a',
            agent_name: 'Ada',
            agent_emoji: '🤖',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 'wf-1',
            name: 'Primary',
            description: 'Default workflow',
            is_default: true,
            stages: [
              { id: 'stage-1', label: 'Build', role: 'Engineer' },
              { id: 'stage-2', label: 'QA', role: 'QA' },
            ],
          },
          {
            id: 'wf-2',
            name: 'Launch',
            description: 'Launch workflow',
            is_default: false,
            stages: [
              { id: 'stage-3', label: 'Plan', role: 'Engineer' },
              { id: 'stage-4', label: 'Review', role: 'QA' },
              { id: 'stage-5', label: 'Ship', role: 'PM' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workflow_template_id: 'wf-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

    mocks.state.agents = [
      { id: 'agent-a', name: 'Ada', role: 'Engineer', avatar_emoji: '🤖' },
      { id: 'agent-b', name: 'Bea', role: 'QA', avatar_emoji: '🔍' },
      { id: 'agent-c', name: 'Pia', role: 'PM', avatar_emoji: '📊' },
    ];

    const { TeamTab } = await import('@/components/TeamTab');
    render(<TeamTab taskId="task-1" workspaceId="workspace-1" />);

    await screen.findByText('Workflow Template');
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.getByText('QA')).toBeInTheDocument();
    expect(screen.getByText(/Missing agents for: qa/i)).toBeInTheDocument();

    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'wf-2' },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks/task-1',
      expect.objectContaining({
        method: 'PATCH',
      })
    ));

    expect(await screen.findByText('Ship')).toBeInTheDocument();

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[2], { target: { value: 'agent-b' } });
    fireEvent.change(selects[3], { target: { value: 'agent-c' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Team' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks/task-1/roles',
      expect.objectContaining({ method: 'PUT' })
    ));

    const saveCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/tasks/task-1/roles' && Boolean(init) && (init as RequestInit).method === 'PUT'
    );
    expect(saveCall).toBeTruthy();
    const payload = JSON.parse((saveCall?.[1] as RequestInit).body as string);
    expect(payload.roles).toEqual([
      expect.objectContaining({ role: 'engineer', agent_id: 'agent-a' }),
      expect.objectContaining({ role: 'qa', agent_id: 'agent-b' }),
      expect.objectContaining({ role: 'pm', agent_id: 'agent-c' }),
    ]);
    expect(await screen.findByText(/Team saved successfully/i)).toBeInTheDocument();
  });

  it('surfaces save errors when the roles API rejects the update', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            role: 'Engineer',
            agent_id: 'agent-a',
            agent_name: 'Ada',
            agent_emoji: '🤖',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 'wf-1',
            name: 'Primary',
            description: 'Default workflow',
            is_default: true,
            stages: [
              { id: 'stage-1', label: 'Build', role: 'Engineer' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workflow_template_id: 'wf-1' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Could not persist roles' }),
      });

    mocks.state.agents = [
      { id: 'agent-a', name: 'Ada', role: 'Engineer', avatar_emoji: '🤖' },
    ];

    const { TeamTab } = await import('@/components/TeamTab');
    render(<TeamTab taskId="task-1" workspaceId="workspace-1" />);

    await screen.findByText('Workflow Template');
    fireEvent.click(screen.getByRole('button', { name: 'Save Team' }));

    expect(await screen.findByText(/Could not persist roles/i)).toBeInTheDocument();
    expect(screen.queryByText(/Team saved successfully/i)).not.toBeInTheDocument();
  });
});

describe('AgentModal', () => {
  it('creates an agent with normalized session routing and closes on success', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          availableModels: ['gpt-4o', 'claude-3.5'],
          defaultModel: 'gpt-4o',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'agent-new',
          name: 'Nova',
          role: 'Planner',
          description: 'Agent description',
          avatar_emoji: '🤖',
          status: 'standby',
          is_master: false,
          soul_md: '',
          user_md: '',
          agents_md: '',
          model: 'gpt-4o',
          session_key_prefix: 'planner:main:',
        }),
      });

    const onClose = vi.fn();
    const onAgentCreated = vi.fn();
    const { AgentModal } = await import('@/components/AgentModal');

    render(
      <AgentModal
        onClose={onClose}
        onAgentCreated={onAgentCreated}
        workspaceId="workspace-1"
      />
    );

    await screen.findByText('Create New Agent');
    await screen.findByRole('option', { name: 'gpt-4o (Default)' });

    fireEvent.change(screen.getByPlaceholderText('Agent name'), {
      target: { value: 'Nova' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g., Code & Automation'), {
      target: { value: 'Planner' },
    });
    fireEvent.change(screen.getByPlaceholderText('What does this agent do?'), {
      target: { value: 'Plans work and keeps execution tight.' },
    });
    fireEvent.change(screen.getByPlaceholderText('agent:main:'), {
      target: { value: 'planner' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onAgentCreated).toHaveBeenCalledWith('agent-new');
    expect(mocks.addAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-new' }));

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/agents' && (init as RequestInit).method === 'POST'
    );
    expect(postCall).toBeTruthy();
    const payload = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(payload.session_key_prefix).toBe('planner:');
    expect(payload.workspace_id).toBe('workspace-1');
  });

  it('loads fresh details for an existing agent and deletes it when confirmed', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          soul_md: '# Fresh soul',
          user_md: '# Fresh user',
          agents_md: '# Fresh agents',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          availableModels: ['gpt-4o'],
          defaultModel: 'gpt-4o',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

    mocks.state.agents = [
      {
        id: 'agent-old',
        name: 'Old Agent',
        role: 'Reviewer',
        description: 'Old description',
        avatar_emoji: '🔍',
        status: 'standby',
        is_master: false,
        soul_md: '',
        user_md: '',
        agents_md: '',
        model: '',
        session_key_prefix: '',
      },
      {
        id: 'agent-keep',
        name: 'Keep Agent',
        role: 'Support',
        avatar_emoji: '💻',
      },
    ];

    const onClose = vi.fn();
    const { AgentModal } = await import('@/components/AgentModal');

    render(
      <AgentModal
        agent={mocks.state.agents[0]}
        onClose={onClose}
        workspaceId="workspace-1"
      />
    );

    await screen.findByText('Edit Old Agent');
    fireEvent.click(screen.getByRole('button', { name: 'SOUL.md' }));
    expect(await screen.findByDisplayValue('# Fresh soul')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(globalThis.confirm).toHaveBeenCalledWith('Delete Old Agent?');
    expect(mocks.setState).toHaveBeenCalled();
    expect(mocks.state.agents.map((agent) => agent.id)).toEqual(['agent-keep']);

    const deleteCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/agents/agent-old' && Boolean(init) && (init as RequestInit).method === 'DELETE'
    );
    expect(deleteCall).toBeTruthy();
  });
});
