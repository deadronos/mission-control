import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MaybePool } from '@/components/autopilot/MaybePool';

describe('MaybePool interaction', () => {
  it('calls resurface endpoint and reloads pool', async () => {
    const entry = { id: 'e1', evaluation_count: 1, idea: { id: 'i1', title: 'Test Idea', description: 'desc' }, idea_id: 'i1', next_evaluate_at: null };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [entry] })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => [entry] });

    (global as any).fetch = fetchMock;

    render(<MaybePool productId="p1" />);

    await waitFor(() => expect(screen.getByText(/Test Idea/)).toBeDefined());

    const resurface = screen.getByRole('button', { name: /Resurface Now/i });
    fireEvent.click(resurface);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      const calledResurface = fetchMock.mock.calls.find((c: any[]) => String(c[0]).includes(`/api/products/p1/maybe/${entry.idea_id}/resurface`));
      expect(calledResurface).toBeTruthy();
    });

    expect(screen.getByText(/Test Idea/)).toBeDefined();
  });
});
