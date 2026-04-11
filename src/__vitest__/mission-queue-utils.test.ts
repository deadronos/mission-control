import { describe, it, expect } from 'vitest';
import { getDispatchFailureMessage } from '@/components/mission-queue-utils';

describe('getDispatchFailureMessage', () => {
  it('returns message from JSON body', () => {
    const body = JSON.stringify({ message: 'hello' });
    expect(getDispatchFailureMessage(400, body)).toBe('hello');
  });

  it('returns fallback for empty body', () => {
    expect(getDispatchFailureMessage(500, '')).toBe('Dispatch failed (500)');
  });

  it('handles 409 otherOrchestrators special case', () => {
    const body = JSON.stringify({ otherOrchestrators: [{ name: 'clawson' }, { name: 'researcher' }] });
    const result = getDispatchFailureMessage(409, body);
    expect(result).toContain('clawson');
    expect(result).toContain('researcher');
  });
});
