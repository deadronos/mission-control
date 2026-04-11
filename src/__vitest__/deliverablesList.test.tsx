import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeliverablesList } from '@/components/DeliverablesList';

const mocks = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  openMock: vi.fn(),
}));

beforeEach(() => {
  mocks.fetchMock.mockReset();
  mocks.openMock.mockReset();
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = mocks.fetchMock as typeof fetch;
  window.open = mocks.openMock;
});

afterEach(() => {
  cleanup();
});

describe('DeliverablesList', () => {
  it('recovers from a load error when retry succeeds', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'temporary outage',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            id: 'd1',
            task_id: 'task-1',
            deliverable_type: 'file',
            title: 'Recovered deliverable',
            path: '/tmp/recovered.html',
            created_at: new Date().toISOString(),
          },
        ]),
      });

    render(<DeliverablesList taskId="task-1" />);

    expect(await screen.findByText(/Could not load deliverables/i)).toBeInTheDocument();
    expect(screen.getByText(/temporary outage/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Could not load deliverables/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText(/Recovered deliverable/i)).toBeInTheDocument();
    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens URLs and previews HTML deliverables', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            id: 'url-1',
            task_id: 'task-2',
            deliverable_type: 'url',
            title: 'Project site',
            path: 'https://example.com',
            created_at: new Date().toISOString(),
          },
          {
            id: 'file-1',
            task_id: 'task-2',
            deliverable_type: 'file',
            title: 'Static build',
            path: '/tmp/build/index.html',
            created_at: new Date().toISOString(),
          },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      });

    render(<DeliverablesList taskId="task-2" />);

    expect(await screen.findByText(/Project site/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Project site/i })).toHaveAttribute('href', 'https://example.com');

    fireEvent.click(screen.getByTitle('Preview in browser'));
    expect(mocks.openMock).toHaveBeenCalledWith('/api/files/preview?path=%2Ftmp%2Fbuild%2Findex.html', '_blank');

    fireEvent.click(screen.getByTitle('Reveal in Finder'));

    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalledWith(
        '/api/files/reveal',
        expect.objectContaining({ method: 'POST' })
      );
    });

    const revealCall = mocks.fetchMock.mock.calls[1];
    expect(JSON.parse((revealCall[1] as RequestInit).body as string)).toEqual({
      filePath: '/tmp/build/index.html',
    });
  });
});
