import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, beforeEach, vi } from 'vitest';
import { MaybePool } from '@/components/autopilot/MaybePool';

beforeEach(() => {
  // stub fetch per-test
  global.fetch = vi.fn();
});

describe('MaybePool', () => {
  it('shows loading then empty state when API returns empty list', async () => {
    (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => [] });

    render(<MaybePool productId="p1" />);

    expect(screen.getByText(/Loading/)).toBeDefined();

    await waitFor(() => expect(screen.getByText(/No ideas in the maybe pool/)).toBeDefined());
  });

  it('renders entries returned by API', async () => {
    const entry = { id: 'e1', evaluation_count: 1, idea: { id: 'i1', title: 'Test Idea', description: 'A short description' }, idea_id: 'i1', next_evaluate_at: null };
    (global.fetch as unknown as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => [entry] });

    render(<MaybePool productId="p1" />);

    await waitFor(() => expect(screen.getByText(/Test Idea/)).toBeDefined());
  });
});
