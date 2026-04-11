/**
 * DeliverablesList Component
 * Displays deliverables (files, URLs, artifacts) for a task
 */

'use client';

import { logger } from '@/lib/logger';
import { useEffect, useState, useCallback } from 'react';
import { debug } from '@/lib/debug';
import { openErrorReport } from './ErrorReportModal';
import { DeliverableCard } from './DeliverableCard';
import type { TaskDeliverable } from '@/lib/types';

interface DeliverablesListProps {
  taskId: string;
}

export function DeliverablesList({ taskId }: DeliverablesListProps) {
  const [deliverables, setDeliverables] = useState<TaskDeliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDeliverables = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/tasks/${taskId}/deliverables`);
      if (!res.ok) {
        const details = await res.text();
        throw new Error(details ? `HTTP ${res.status}: ${details}` : `HTTP ${res.status}`);
      }

      const data = await res.json();
      setDeliverables(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setError(message);
      logger.error({ taskId, error: message }, 'Failed to load deliverables');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadDeliverables();
  }, [loadDeliverables]);

  const handleOpen = async (deliverable: TaskDeliverable) => {
    if (deliverable.deliverable_type === 'url' && deliverable.path) {
      window.open(deliverable.path, '_blank');
      return;
    }

    if (deliverable.path) {
      try {
        debug.file('Opening file in Finder', { path: deliverable.path });
        const res = await fetch('/api/files/reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: deliverable.path }),
        });

        if (res.ok) {
          debug.file('Opened in Finder successfully');
          return;
        }

        const error = await res.json();
        debug.file('Failed to open', error);

        if (res.status === 404) {
          alert(`File not found:\n${deliverable.path}\n\nThe file may have been moved or deleted.`);
        } else if (res.status === 403) {
          alert(`Cannot open this location:\n${deliverable.path}\n\nPath is outside allowed directories.`);
        } else {
          throw new Error(error.error || 'Unknown error');
        }
      } catch (error) {
        logger.error('Failed to open file:', error);
        try {
          await navigator.clipboard.writeText(deliverable.path);
          alert(`Could not open Finder. Path copied to clipboard:\n${deliverable.path}`);
        } catch {
          alert(`File path:\n${deliverable.path}`);
        }
      }
    }
  };

  const handlePreview = (deliverable: TaskDeliverable) => {
    if (deliverable.path) {
      debug.file('Opening preview', { path: deliverable.path });
      window.open(`/api/files/preview?path=${encodeURIComponent(deliverable.path)}`, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-mc-text-secondary">Loading deliverables...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-red-300">Could not load deliverables</h4>
              <p className="mt-1 text-sm text-red-400 whitespace-pre-wrap break-words">{error}</p>
            </div>
            <button
              type="button"
              onClick={loadDeliverables}
              className="shrink-0 text-xs px-2.5 py-1.5 rounded border border-red-400/40 text-red-300 hover:bg-red-400/10"
            >
              Retry
            </button>
          </div>
          <button
            type="button"
            onClick={() => void openErrorReport({
              errorType: 'deliverables_load_failed',
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

  if (deliverables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-mc-text-secondary">
        <div className="text-4xl mb-2">📦</div>
        <p>No deliverables yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {deliverables.map((deliverable) => (
        <DeliverableCard
          key={deliverable.id}
          deliverable={deliverable}
          onOpen={handleOpen}
          onPreview={handlePreview}
        />
      ))}
    </div>
  );
}
