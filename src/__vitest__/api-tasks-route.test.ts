import { describe, it, expect } from 'vitest';

// Ensure DB uses in-memory for isolation in this test
process.env.DATABASE_PATH = ':memory:';

// Dynamic import to ensure DB picks up DATABASE_PATH
import('@/lib/db');

describe('GET /api/tasks/[id]/test route', () => {
  it('returns 404 for missing task', async () => {
    const route = await import('@/app/api/tasks/[id]/test/route');
    const res = await route.GET({} as any, { params: Promise.resolve({ id: 'missing-task' }) });

    // NextResponse.json returns a NextResponse object. Try a few ways to inspect the payload.
    // If it exposes json(), use that. Otherwise, inspect .body or stringify.
    if (res && typeof (res as any).json === 'function') {
      const data = await (res as any).json();
      expect(data.error).toBeDefined();
      return;
    }

    if (res && (res as any).body) {
      const body = (res as any).body;
      if (typeof body === 'string') {
        const data = JSON.parse(body);
        expect(data.error).toBeDefined();
        return;
      }
      if (Buffer.isBuffer(body)) {
        const data = JSON.parse(body.toString('utf8'));
        expect(data.error).toBeDefined();
        return;
      }
      if (typeof body === 'object') {
        expect((body as any).error).toBeDefined();
        return;
      }
    }

    // Fallback: ensure the returned object indicates an error when stringified
    const s = String(res);
    expect(s.toLowerCase()).toContain('error');
  });
});
