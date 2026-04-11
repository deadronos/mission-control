import { describe, it, expect } from 'vitest';
import { shouldShowReviewAll } from '@/components/autopilot/swipeDeck-utils';
import { SWIPE_BATCH_THRESHOLD } from '@/lib/constants';

describe('shouldShowReviewAll', () => {
  it('returns false when below threshold', () => {
    expect(shouldShowReviewAll(SWIPE_BATCH_THRESHOLD - 1)).toBe(false);
  });

  it('returns true when at threshold', () => {
    expect(shouldShowReviewAll(SWIPE_BATCH_THRESHOLD)).toBe(true);
  });
});
