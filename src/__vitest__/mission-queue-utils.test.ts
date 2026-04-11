import { describe, it, expect } from 'vitest';
import { getDispatchFailureMessage } from '@/components/mission-queue-utils';

describe('getDispatchFailureMessage', () => {
  it('returns message from JSON body', () => {
    const body = JSON.stringify({ message: 'hello' });
    expect(getDispatchFailureMessage(400, body)).toBe('hello');
  });

  it('returns warning when present', () => {
    const body = JSON.stringify({ warning: 'Be careful' });
    expect(getDispatchFailureMessage(400, body)).toBe('Be careful');
  });

  it('returns details when present', () => {
    const body = JSON.stringify({ details: 'detailed info' });
    expect(getDispatchFailureMessage(400, body)).toBe('detailed info');
  });

  it('returns error when present', () => {
    const body = JSON.stringify({ error: 'broken' });
    expect(getDispatchFailureMessage(400, body)).toBe('broken');
  });

  it('returns fallback for empty body', () => {
    expect(getDispatchFailureMessage(500, '')).toBe('Dispatch failed (500)');
  });

  it('handles 409 otherOrchestrators special case', () => {
    const body = JSON.stringify({ otherOrchestrators: [{ name: 'clawson' }, { name: null }, {}] });
    const result = getDispatchFailureMessage(409, body);
    expect(result).toContain('clawson');
    expect(result).not.toContain('null');
  });

  it('returns trimmed raw text for non-JSON body', () => {
    const raw = 'Some plain text';
    expect(getDispatchFailureMessage(418, raw)).toBe(raw);
  });
});
