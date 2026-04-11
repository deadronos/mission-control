'use client';

import { ClipboardList, ExternalLink } from 'lucide-react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { openErrorReport } from './ErrorReportModal';
import type { Agent, Task, TaskPriority, TaskStatus } from '@/lib/types';

export interface TaskModalFormValues {
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_agent_id: string;
  due_date: string;
}

interface TaskModalOverviewFormProps {
  task?: Task;
  agents: Agent[];
  form: TaskModalFormValues;
  setForm: Dispatch<SetStateAction<TaskModalFormValues>>;
  usePlanningMode: boolean;
  setUsePlanningMode: Dispatch<SetStateAction<boolean>>;
  priorities: TaskPriority[];
  saveError: string | null;
  onAddAgent: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}

export function TaskModalOverviewForm({
  task,
  agents,
  form,
  setForm,
  usePlanningMode,
  setUsePlanningMode,
  priorities,
  saveError,
  onAddAgent,
  onSubmit,
}: TaskModalOverviewFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Title</label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
          className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
          placeholder="What needs to be done?"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
          className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none"
          placeholder="Add details..."
        />
      </div>

      {!task && (
        <div className="p-3 bg-mc-bg rounded-lg border border-mc-border">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={usePlanningMode}
              onChange={(e) => setUsePlanningMode(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded border-mc-border"
            />
            <div>
              <span className="font-medium text-sm flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-mc-accent" />
                Enable Planning Mode
              </span>
              <p className="text-xs text-mc-text-secondary mt-1">
                Best for complex projects that need detailed requirements.
                You&apos;ll answer a few questions to define scope, goals, and constraints
                before work begins. Skip this for quick, straightforward tasks.
              </p>
            </div>
          </label>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Assign to</label>
        <select
          value={form.assigned_agent_id}
          onChange={(e) => {
            if (e.target.value === '__add_new__') {
              onAddAgent();
            } else {
              setForm({ ...form, assigned_agent_id: e.target.value });
            }
          }}
          className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
        >
          <option value="">Unassigned</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.avatar_emoji} {agent.name} - {agent.role}
            </option>
          ))}
          <option value="__add_new__" className="text-mc-accent">
            ➕ Add new agent...
          </option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Priority</label>
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
            className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
          >
            {priorities.map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Due Date</label>
          <input
            type="datetime-local"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
          />
        </div>
      </div>

      {task?.pr_url && (
        <div className="p-3 bg-mc-bg rounded-lg border border-mc-border">
          <h4 className="text-sm font-medium text-mc-text mb-2 flex items-center gap-2">
            <ExternalLink className="w-4 h-4" />
            Pull Request
          </h4>
          <div className="flex items-center gap-3">
            <a
              href={task.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-mc-accent hover:underline break-all"
            >
              {task.pr_url}
            </a>
            {task.pr_status && (
              <span
                className={`shrink-0 text-xs px-2 py-1 rounded font-medium ${
                  task.pr_status === 'open' ? 'bg-blue-500/20 text-blue-400' :
                  task.pr_status === 'merged' ? 'bg-green-500/20 text-green-400' :
                  task.pr_status === 'closed' ? 'bg-red-500/20 text-red-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}
              >
                {task.pr_status}
              </span>
            )}
          </div>
        </div>
      )}

      {saveError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-300">Could not save task</p>
            <p className="text-sm text-red-400 mt-1 whitespace-pre-wrap break-words">{saveError}</p>
          </div>
          <button
            type="button"
            onClick={() => void openErrorReport({
              errorType: 'task_save_failed',
              errorMessage: saveError,
              taskId: task?.id,
            })}
            className="shrink-0 text-xs px-2.5 py-1.5 rounded border border-red-400/40 text-red-300 hover:bg-red-400/10"
          >
            Report
          </button>
        </div>
      )}
    </form>
  );
}
