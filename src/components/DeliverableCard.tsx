'use client';

import { ExternalLink, Eye, FileText, Link as LinkIcon, Package } from 'lucide-react';
import type { TaskDeliverable } from '@/lib/types';

interface DeliverableCardProps {
  deliverable: TaskDeliverable;
  onOpen: (deliverable: TaskDeliverable) => void;
  onPreview: (deliverable: TaskDeliverable) => void;
}

function getDeliverableIcon(type: string) {
  switch (type) {
    case 'file':
      return <FileText className="w-5 h-5" />;
    case 'url':
      return <LinkIcon className="w-5 h-5" />;
    case 'artifact':
      return <Package className="w-5 h-5" />;
    default:
      return <FileText className="w-5 h-5" />;
  }
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function DeliverableCard({ deliverable, onOpen, onPreview }: DeliverableCardProps) {
  return (
    <div className="flex gap-3 p-3 bg-mc-bg rounded-lg border border-mc-border hover:border-mc-accent transition-colors">
      <div className="flex-shrink-0 text-mc-accent">
        {getDeliverableIcon(deliverable.deliverable_type)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          {deliverable.deliverable_type === 'url' && deliverable.path ? (
            <a
              href={deliverable.path}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-mc-accent hover:text-mc-accent/80 hover:underline flex items-center gap-1.5"
            >
              {deliverable.title}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : (
            <h4 className="font-medium text-mc-text">{deliverable.title}</h4>
          )}

          <div className="flex items-center gap-1">
            {deliverable.deliverable_type === 'file' && deliverable.path?.endsWith('.html') && (
              <button
                onClick={() => onPreview(deliverable)}
                className="flex-shrink-0 p-1.5 hover:bg-mc-bg-tertiary rounded text-mc-accent-cyan"
                title="Preview in browser"
              >
                <Eye className="w-4 h-4" />
              </button>
            )}
            {deliverable.path && (
              <button
                onClick={() => onOpen(deliverable)}
                className="flex-shrink-0 p-1.5 hover:bg-mc-bg-tertiary rounded text-mc-accent"
                title={deliverable.deliverable_type === 'url' ? 'Open URL' : 'Reveal in Finder'}
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {deliverable.description && (
          <p className="text-sm text-mc-text-secondary mt-1">
            {deliverable.description}
          </p>
        )}

        {deliverable.path && (
          deliverable.deliverable_type === 'url' ? (
            <a
              href={deliverable.path}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 p-2 bg-mc-bg-tertiary rounded text-xs text-mc-accent hover:text-mc-accent/80 font-mono break-all block hover:bg-mc-bg-tertiary/80"
            >
              {deliverable.path}
            </a>
          ) : (
            <div className="mt-2 p-2 bg-mc-bg-tertiary rounded text-xs text-mc-text-secondary font-mono break-all">
              {deliverable.path}
            </div>
          )
        )}

        <div className="flex items-center gap-4 mt-2 text-xs text-mc-text-secondary">
          <span className="capitalize">{deliverable.deliverable_type}</span>
          <span>•</span>
          <span>{formatTimestamp(deliverable.created_at)}</span>
        </div>
      </div>
    </div>
  );
}
