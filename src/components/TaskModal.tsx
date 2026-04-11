'use client';

import { logger } from '@/lib/logger';
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useShallow } from 'zustand/react/shallow';
import { X, Save, Trash2, Activity, Package, Bot, ClipboardList, Plus, Users, ImageIcon, Truck, Radio, MessageSquare, HardDrive } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { triggerAutoDispatch, shouldTriggerAutoDispatch } from '@/lib/auto-dispatch';
import { ActivityLog } from './ActivityLog';
import { DeliverablesList } from './DeliverablesList';
import { SessionsList } from './SessionsList';
import { PlanningTab } from './PlanningTab';
import { TeamTab } from './TeamTab';
import { AgentModal } from './AgentModal';
import { TaskImages } from './TaskImages';
import { ConvoyTab } from './ConvoyTab';
import { AgentLiveTab } from './AgentLiveTab';
import { TaskChatTab } from './TaskChatTab';
import { WorkspaceTab } from './WorkspaceTab';
import { TaskModalOverviewForm, type TaskModalFormValues } from './TaskModalOverviewForm';
import type { Task, TaskPriority, TaskStatus } from '@/lib/types';

type TabType = 'overview' | 'planning' | 'convoy' | 'team' | 'activity' | 'deliverables' | 'images' | 'sessions' | 'workspace' | 'agent-live' | 'chat';

interface TaskModalProps {
  task?: Task;
  onClose: () => void;
  workspaceId?: string;
}

export function TaskModal({ task, onClose, workspaceId }: TaskModalProps) {
  const router = useRouter();
  const { agents, addTask, updateTask, addEvent } = useMissionControl(
    useShallow((state) => ({
      agents: state.agents,
      addTask: state.addTask,
      updateTask: state.updateTask,
      addEvent: state.addEvent,
    }))
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [usePlanningMode, setUsePlanningMode] = useState(false);
  // Auto-switch to relevant tab based on task status
  const [activeTab, setActiveTab] = useState<TabType>(
    task?.status === 'planning' ? 'planning' : task?.status === 'convoy_active' ? 'convoy' : 'overview'
  );

  // Refresh data when spec is locked (planning completed)
  const handleSpecLocked = useCallback(() => {
    router.refresh();
  }, [router]);

  const [form, setForm] = useState<TaskModalFormValues>({
    title: task?.title || '',
    description: task?.description || '',
    priority: task?.priority || 'normal' as TaskPriority,
    status: task?.status || 'inbox' as TaskStatus,
    assigned_agent_id: task?.assigned_agent_id || '',
    due_date: task?.due_date || '',
  });

  const resolveStatus = (): TaskStatus => {
    // Planning mode overrides everything
    if (!task && usePlanningMode) return 'planning';
    // Auto-determine based on agent assignment
    const hasAgent = !!form.assigned_agent_id;
    if (!task) {
      // New task: agent → assigned, no agent → inbox
      return hasAgent ? 'assigned' : 'inbox';
    }
    // Existing task: if in inbox and agent just assigned, promote to assigned
    if (task.status === 'inbox' && hasAgent) return 'assigned';
    return form.status;
  };

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent, keepOpen = false) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSaveError(null);

    try {
      const url = task ? `/api/tasks/${task.id}` : '/api/tasks';
      const method = task ? 'PATCH' : 'POST';
      const resolvedStatus = resolveStatus();

      const payload = {
        ...form,
        status: resolvedStatus,
        assigned_agent_id: form.assigned_agent_id || null,
        due_date: form.due_date || null,
        workspace_id: workspaceId || task?.workspace_id || 'default',
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const raw = await res.text();
        let errData: { error?: string; details?: unknown } = {};
        try {
          errData = raw ? JSON.parse(raw) : {};
        } catch {
          errData = { error: raw };
        }

        const detailText = Array.isArray(errData.details)
          ? errData.details
              .map((issue) => typeof issue === 'object' && issue && 'message' in issue ? String((issue as { message?: string }).message) : String(issue))
              .join('; ')
          : typeof errData.details === 'string'
            ? errData.details
            : '';

        setSaveError([errData.error || `Save failed (${res.status})`, detailText].filter(Boolean).join(' · '));
        return;
      }

      const savedTask = await res.json();

      if (task) {
        // Editing existing task
        updateTask(savedTask);

        // Note: dispatch for existing tasks is handled server-side by the PATCH route.
        // Only trigger client-side dispatch for drag-to-in_progress (legacy flow).
        if (shouldTriggerAutoDispatch(task.status, savedTask.status, savedTask.assigned_agent_id)) {
          triggerAutoDispatch({
            taskId: savedTask.id,
            taskTitle: savedTask.title,
            agentId: savedTask.assigned_agent_id,
            agentName: savedTask.assigned_agent?.name || 'Unknown Agent',
            workspaceId: savedTask.workspace_id
          }).catch((err) => logger.error('Auto-dispatch failed:', err));
        }

        onClose();
        return;
      }

      // Creating new task
      addTask(savedTask);
      addEvent({
        id: savedTask.id + '-created',
        type: 'task_created',
        task_id: savedTask.id,
        message: `New task: ${savedTask.title}`,
        created_at: new Date().toISOString(),
      });

      if (usePlanningMode) {
        // Start planning session (fire-and-forget), then close modal.
        // User reopens the task from the board to see the planning tab.
        fetch(`/api/tasks/${savedTask.id}/planning`, { method: 'POST' })
          .catch((error) => logger.error('Failed to start planning:', error));
        onClose();
        return;
      }

      // Auto-dispatch if agent assigned (fire-and-forget)
      if (savedTask.assigned_agent_id && savedTask.status === 'assigned') {
        triggerAutoDispatch({
          taskId: savedTask.id,
          taskTitle: savedTask.title,
          agentId: savedTask.assigned_agent_id,
          agentName: savedTask.assigned_agent?.name || 'Unknown Agent',
          workspaceId: savedTask.workspace_id
        }).catch((err) => logger.error('Auto-dispatch failed:', err));
      }

      if (keepOpen) {
        // "Save & New": clear form, stay open
        setForm({
          title: '',
          description: '',
          priority: 'normal' as TaskPriority,
          status: 'inbox' as TaskStatus,
          assigned_agent_id: '',
          due_date: '',
        });
        setUsePlanningMode(false);
      } else {
        onClose();
      }
    } catch (error) {
      logger.error('Failed to save task:', error);
      setSaveError(error instanceof Error ? error.message : 'Network error — please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!task || !confirm(`Delete "${task.title}"?`)) return;

    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (res.ok) {
        useMissionControl.setState((state) => ({
          tasks: state.tasks.filter((t) => t.id !== task.id),
        }));
        onClose();
      }
    } catch (error) {
      logger.error('Failed to delete task:', error);
    }
  };

  const priorities: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview', icon: null },
    { id: 'planning' as TabType, label: 'Planning', icon: <ClipboardList className="w-4 h-4" /> },
    { id: 'convoy' as TabType, label: 'Convoy', icon: <Truck className="w-4 h-4" /> },
    { id: 'team' as TabType, label: 'Team', icon: <Users className="w-4 h-4" /> },
    { id: 'activity' as TabType, label: 'Activity', icon: <Activity className="w-4 h-4" /> },
    { id: 'deliverables' as TabType, label: 'Deliverables', icon: <Package className="w-4 h-4" /> },
    { id: 'images' as TabType, label: 'Images', icon: <ImageIcon className="w-4 h-4" /> },
    { id: 'sessions' as TabType, label: 'Sessions', icon: <Bot className="w-4 h-4" /> },
    // Workspace tab — shown when task has workspace isolation
    ...(task?.workspace_path ? [{ id: 'workspace' as TabType, label: 'Workspace', icon: <HardDrive className="w-4 h-4" /> }] : []),
    // Chat is always available — messages dispatch the agent if needed
    { id: 'chat' as TabType, label: 'Chat', icon: <MessageSquare className="w-4 h-4" /> },
    // Agent Live only shown when agent is active
    ...(task && ['in_progress', 'convoy_active', 'testing', 'verification'].includes(task.status)
      ? [
          { id: 'agent-live' as TabType, label: 'Agent Live', icon: <Radio className="w-4 h-4" /> },
        ]
      : []),
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-3 sm:p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-t-xl sm:rounded-lg w-full max-w-2xl max-h-[92vh] sm:max-h-[90vh] flex flex-col pb-[env(safe-area-inset-bottom)] sm:pb-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-mc-border flex-shrink-0">
          <h2 className="text-lg font-semibold">
            {task ? task.title : 'Create New Task'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-mc-bg-tertiary rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs - only show for existing tasks */}
        {task && (
          <div className="flex border-b border-mc-border flex-shrink-0 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 min-h-11 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'text-mc-accent border-b-2 border-mc-accent'
                    : 'text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <TaskModalOverviewForm
              task={task}
              agents={agents}
              form={form}
              setForm={setForm}
              usePlanningMode={usePlanningMode}
              setUsePlanningMode={setUsePlanningMode}
              priorities={priorities}
              saveError={saveError}
              onAddAgent={() => setShowAgentModal(true)}
              onSubmit={(e) => handleSubmit(e)}
            />
          )}

          {/* Planning Tab */}
          {activeTab === 'planning' && task && (
            <PlanningTab
              taskId={task.id}
              onSpecLocked={handleSpecLocked}
            />
          )}

          {/* Convoy Tab */}
          {activeTab === 'convoy' && task && (
            <ConvoyTab taskId={task.id} taskTitle={task.title} taskStatus={task.status} />
          )}

          {/* Team Tab */}
          {activeTab === 'team' && task && (
            <TeamTab taskId={task.id} workspaceId={workspaceId || task.workspace_id || 'default'} />
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && task && (
            <ActivityLog taskId={task.id} />
          )}

          {/* Deliverables Tab */}
          {activeTab === 'deliverables' && task && (
            <DeliverablesList taskId={task.id} />
          )}

          {/* Images Tab */}
          {activeTab === 'images' && task && (
            <TaskImages taskId={task.id} />
          )}

          {/* Sessions Tab */}
          {activeTab === 'sessions' && task && (
            <SessionsList taskId={task.id} />
          )}

          {/* Agent Live Tab */}
          {activeTab === 'agent-live' && task && (
            <AgentLiveTab taskId={task.id} />
          )}

          {/* Chat Tab */}
          {/* Workspace Tab */}
          {activeTab === 'workspace' && task && (
            <WorkspaceTab taskId={task.id} taskStatus={task.status} />
          )}

          {activeTab === 'chat' && task && (
            <TaskChatTab taskId={task.id} />
          )}
        </div>

        {/* Footer - only show on overview tab */}
        {activeTab === 'overview' && (
          <div className="flex items-center justify-between p-4 border-t border-mc-border flex-shrink-0">
            <div className="flex gap-2">
              {task && (
                <>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="min-h-11 flex items-center gap-2 px-3 py-2 text-mc-accent-red hover:bg-mc-accent-red/10 rounded text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 px-4 py-2 text-sm text-mc-text-secondary hover:text-mc-text"
              >
                Cancel
              </button>
              {!task && (
                <button
                  onClick={(e) => handleSubmit(e, true)}
                  disabled={isSubmitting}
                  className="min-h-11 flex items-center gap-2 px-4 py-2 border border-mc-accent text-mc-accent rounded text-sm font-medium hover:bg-mc-accent/10 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  {isSubmitting ? 'Saving...' : 'Save & New'}
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="min-h-11 flex items-center gap-2 px-4 py-2 bg-mc-accent text-mc-bg rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Nested Agent Modal for inline agent creation */}
      {showAgentModal && (
        <AgentModal
          workspaceId={workspaceId}
          onClose={() => setShowAgentModal(false)}
          onAgentCreated={(agentId) => {
            // Auto-select the newly created agent
            setForm({ ...form, assigned_agent_id: agentId });
            setShowAgentModal(false);
          }}
        />
      )}
    </div>
  );
}
