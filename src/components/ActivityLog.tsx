/**
 * ActivityLog Component
 * Displays chronological activity log for a task
 */

'use client';

import { logger } from '@/lib/logger';
import { useEffect, useState, useRef, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { openErrorReport } from './ErrorReportModal';
import type { TaskActivity } from '@/lib/types';

interface ActivityLogProps {
  taskId: string;
}

export function ActivityLog({ taskId }: ActivityLogProps) {
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const lastCountRef = useRef(0);

  const loadActivities = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);

      const res = await fetch(`/api/tasks/${taskId}/activities`);
      if (!res.ok) {
        const details = await res.text();
        throw new Error(details ? `HTTP ${res.status}: ${details}` : `HTTP ${res.status}`);
      }

      const data = await res.json();
      setActivities(data);
      lastCountRef.current = data.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setError(message);
      logger.error({ taskId, error: message }, 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadActivities(true);
  }, [taskId, loadActivities]);

  const pollForActivities = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/activities`);
      if (res.ok) {
        setError(null);
        const data = await res.json();
        if (data.length !== lastCountRef.current) {
          setActivities(data);
          lastCountRef.current = data.length;
        }
      }
    } catch (error) {
      logger.error('Polling error:', error);
    }
  }, [taskId]);

  useEffect(() => {
    const pollInterval = setInterval(pollForActivities, 5000);
    pollingRef.current = pollInterval;

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [taskId, pollForActivities]);

  const getActivityIcon = (type: string, message?: string) => {
    switch (type) {
      case 'spawned':
        return '🚀';
      case 'updated':
        return '✏️';
      case 'completed':
        return '✅';
      case 'file_created':
        return '📄';
      case 'status_changed':
        if (message?.includes('Convoy')) return '🚚';
        if (message?.includes('health:')) return '💓';
        if (message?.includes('nudged')) return '👋';
        return '🔄';
      default:
        return '📝';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-mc-text-secondary">Loading activities...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-red-300">Could not load activity feed</h4>
              <p className="mt-1 text-sm text-red-400 whitespace-pre-wrap break-words">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => loadActivities(true)}
              className="shrink-0 text-xs px-2.5 py-1.5 rounded border border-red-400/40 text-red-300 hover:bg-red-400/10"
            >
              Retry
            </button>
          </div>
          <button
            type="button"
            onClick={() => void openErrorReport({
              errorType: 'activities_load_failed',
              errorMessage: error,
              taskId,
            })}
            className="mt-3 text-xs px-2.5 py-1.5 rounded border border-red-400/40 text-red-300 hover:bg-red-400/10"
          >
            Report issue
          </button>
        </div>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-mc-text-secondary">
        <div className="text-4xl mb-2">📝</div>
        <p>No activity yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <div
          key={activity.id}
          className="flex gap-3 p-3 bg-mc-bg rounded-lg border border-mc-border"
        >
          <div className="text-2xl flex-shrink-0">
            {getActivityIcon(activity.activity_type, activity.message)}
          </div>

          <div className="flex-1 min-w-0">
            {activity.agent && (
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm">{activity.agent.avatar_emoji}</span>
                <span className="text-sm font-medium text-mc-text">
                  {activity.agent.name}
                </span>
              </div>
            )}

            <p className="text-sm text-mc-text break-words">
              {activity.message}
            </p>

            {activity.metadata && (
              <div className="mt-2 p-2 bg-mc-bg-tertiary rounded text-xs text-mc-text-secondary font-mono">
                {typeof activity.metadata === 'string'
                  ? activity.metadata
                  : JSON.stringify(JSON.parse(activity.metadata), null, 2)}
              </div>
            )}

            <div className="text-xs text-mc-text-secondary mt-2">
              {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
