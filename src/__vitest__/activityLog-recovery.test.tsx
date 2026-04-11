import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ActivityLog } from '@/components/ActivityLog';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ActivityLog recovery', () => {
  it('clears the error state after a later successful poll', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'server temporarily unavailable',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            id: 'a1',
            task_id: 'task-1',
            activity_type: 'updated',
            message: 'Recovered activity',
            created_at: new Date().toISOString(),
          },
        ]),
      });

    (global as any).fetch = fetchMock;

    render(<ActivityLog taskId="task-1" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Could not load activity feed/i)).toBeInTheDocument();
    expect(screen.getByText(/server temporarily unavailable/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText(/Could not load activity feed/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Recovered activity/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
