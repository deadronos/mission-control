import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createProduct } from './products';
import { queryOne, run } from '@/lib/db';

const broadcastMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/events', () => ({
  broadcast: broadcastMock,
}));

function createVariantRow(productId: string, name: string, content: string, isControl = false) {
  return run(
    `INSERT INTO product_program_variants (id, product_id, name, content, is_control, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [randomUUID(), productId, name, content, isControl ? 1 : 0]
  );
}

function insertIdea(productId: string, variantId: string, title: string) {
  const id = randomUUID();
  run(
    `INSERT INTO ideas (
       id, product_id, title, description, category, variant_id, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'feature', ?, 'pending', datetime('now'), datetime('now'))`,
    [id, productId, title, `${title} description`, variantId]
  );
  return id;
}

function insertTask(productId: string, ideaId: string, status: 'done' | 'in_progress' = 'done') {
  const id = randomUUID();
  run(
    `INSERT INTO tasks (
       id, title, status, priority, product_id, idea_id, workspace_id, business_id, created_at, updated_at
     ) VALUES (?, ?, ?, 'normal', ?, ?, 'default', 'default', datetime('now'), datetime('now'))`,
    [id, `Task for ${ideaId}`, status, productId, ideaId]
  );
  return id;
}

function insertSwipe(ideaId: string, productId: string, action: 'approve' | 'reject' | 'maybe' | 'fire') {
  run(
    `INSERT INTO swipe_history (id, idea_id, product_id, action, category, created_at)
     VALUES (?, ?, ?, ?, 'feature', datetime('now'))`,
    [randomUUID(), ideaId, productId, action]
  );
}

function insertCostEvent(productId: string, taskId: string, costUsd: number) {
  run(
    `INSERT INTO cost_events (id, product_id, workspace_id, task_id, event_type, cost_usd, created_at)
     VALUES (?, ?, 'default', ?, 'build_task', ?, datetime('now'))`,
    [randomUUID(), productId, taskId, costUsd]
  );
}

function cleanupProduct(productId: string) {
  run('DELETE FROM cost_events WHERE product_id = ?', [productId]);
  run('DELETE FROM swipe_history WHERE product_id = ?', [productId]);
  run('DELETE FROM tasks WHERE product_id = ?', [productId]);
  run('DELETE FROM ideas WHERE product_id = ?', [productId]);
  run('DELETE FROM product_ab_tests WHERE product_id = ?', [productId]);
  run('DELETE FROM product_program_variants WHERE product_id = ?', [productId]);
  run('DELETE FROM products WHERE id = ?', [productId]);
}

beforeEach(() => {
  broadcastMock.mockClear();
  run(`INSERT OR IGNORE INTO workspaces (id, name, slug)
       VALUES ('default', 'Default', 'default')`);
});

afterEach(() => {
  // Cleanup by prefix is handled explicitly in each test.
});

describe('ab-testing', () => {
  it('covers variant CRUD and delete guards', async () => {
    const product = createProduct({
      name: `AB Product ${randomUUID()}`,
      description: 'A/B test fixture',
      product_program: 'Primary program',
      workspace_id: 'default',
    });

    try {
      const {
        createVariant,
        listVariants,
        getVariant,
        updateVariant,
        deleteVariant,
      } = await import('./ab-testing');

      const control = createVariant({
        product_id: product.id,
        name: 'Control',
        content: 'Control content',
        is_control: true,
      });
      const variant = createVariant({
        product_id: product.id,
        name: 'Variant',
        content: 'Variant content',
      });

      expect(listVariants(product.id).map((item) => item.name)).toEqual(['Control', 'Variant']);
      expect(getVariant(control.id)?.name).toBe('Control');
      expect(updateVariant(control.id, {})?.name).toBe('Control');
      expect(updateVariant(control.id, { name: 'Control v2' })?.name).toBe('Control v2');
      expect(deleteVariant(variant.id)).toEqual({ success: true });

      const blocker = createVariant({
        product_id: product.id,
        name: 'Blocker',
        content: 'Blocker content',
      });

      run(
        `INSERT INTO product_ab_tests (
           id, product_id, variant_a_id, variant_b_id, status, split_mode, min_swipes, created_at
         ) VALUES (?, ?, ?, ?, 'active', 'concurrent', 10, datetime('now'))`,
        [randomUUID(), product.id, control.id, blocker.id]
      );

      expect(deleteVariant(control.id)).toEqual({
        success: false,
        error: 'Cannot delete variant that is used in an A/B test',
      });
    } finally {
      cleanupProduct(product.id);
    }
  });

  it('starts, concludes, cancels, and promotes tests with the expected guardrails', async () => {
    const product = createProduct({
      name: `AB Product ${randomUUID()}`,
      description: 'Lifecycle fixture',
      product_program: 'Primary program',
      workspace_id: 'default',
    });
    const otherProduct = createProduct({
      name: `AB Product ${randomUUID()}`,
      description: 'Foreign fixture',
      product_program: 'Foreign program',
      workspace_id: 'default',
    });

    try {
      const { createVariant, startTest, concludeTest, cancelTest, promoteWinner, getActiveTest } = await import('./ab-testing');

      const variantA = createVariant({
        product_id: product.id,
        name: 'A',
        content: 'Variant A',
        is_control: true,
      });
      const variantB = createVariant({
        product_id: product.id,
        name: 'B',
        content: 'Variant B',
      });
      const variantC = createVariant({
        product_id: product.id,
        name: 'C',
        content: 'Variant C',
      });
      const foreignVariant = createVariant({
        product_id: otherProduct.id,
        name: 'Foreign',
        content: 'Foreign content',
      });

      expect(startTest({
        product_id: product.id,
        variant_a_id: variantA.id,
        variant_b_id: variantA.id,
      })).toEqual({ error: 'Variant A and Variant B must be different' });

      expect(startTest({
        product_id: product.id,
        variant_a_id: variantA.id,
        variant_b_id: foreignVariant.id,
      })).toEqual({ error: 'Variant B not found or does not belong to this product' });

      const started = startTest({
        product_id: product.id,
        variant_a_id: variantA.id,
        variant_b_id: variantB.id,
        split_mode: 'concurrent',
        min_swipes: 10,
      });

      expect(started.test?.status).toBe('active');
      expect(getActiveTest(product.id)?.id).toBe(started.test?.id);
      expect(broadcastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ab_test_started' }));

      expect(startTest({
        product_id: product.id,
        variant_a_id: variantA.id,
        variant_b_id: variantC.id,
      })).toEqual({
        error: 'An active A/B test already exists for this product. Conclude or cancel it first.',
      });

      expect(concludeTest('missing-test', variantA.id)).toEqual({ error: 'A/B test not found' });
      expect(concludeTest(started.test!.id, variantC.id)).toEqual({ error: 'Winner must be one of the test variants' });
      expect(promoteWinner(started.test!.id)).toEqual({
        success: false,
        error: 'Test must be concluded before promoting',
      });

      const concluded = concludeTest(started.test!.id, variantA.id);
      expect(concluded.test?.status).toBe('concluded');
      expect(broadcastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ab_test_concluded' }));
      expect(promoteWinner(started.test!.id)).toEqual({ success: true });
      expect(cancelTest(started.test!.id)).toEqual({ error: 'Test is not active' });

      const cancellable = startTest({
        product_id: product.id,
        variant_a_id: variantB.id,
        variant_b_id: variantC.id,
      });
      expect(cancellable.test?.status).toBe('active');

      const cancelled = cancelTest(cancellable.test!.id);
      expect(cancelled.test?.status).toBe('cancelled');
      expect(broadcastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ab_test_cancelled' }));
    } finally {
      cleanupProduct(product.id);
      cleanupProduct(otherProduct.id);
    }
  });

  it('compares metrics, generates analysis, and resolves research programs', async () => {
    const rawProduct = createProduct({
      name: `AB Product ${randomUUID()}`,
      description: 'Raw comparison fixture',
      product_program: 'Raw primary program',
      workspace_id: 'default',
    });
    const ciProduct = createProduct({
      name: `AB Product ${randomUUID()}`,
      description: 'CI comparison fixture',
      product_program: 'CI primary program',
      workspace_id: 'default',
    });
    const significanceProduct = createProduct({
      name: `AB Product ${randomUUID()}`,
      description: 'Significance fixture',
      product_program: 'Winner primary program',
      workspace_id: 'default',
    });
    const concurrentProduct = createProduct({
      name: `AB Product ${randomUUID()}`,
      description: 'Concurrent fixture',
      product_program: 'Concurrent primary program',
      workspace_id: 'default',
    });
    const alternatingProduct = createProduct({
      name: `AB Product ${randomUUID()}`,
      description: 'Alternating fixture',
      product_program: 'Alternating primary program',
      workspace_id: 'default',
    });

    try {
      const {
        createVariant,
        startTest,
        concludeTest,
        getTestComparison,
        getResearchPrograms,
        analyzeWinnerDelta,
        chiSquaredTest,
      } = await import('./ab-testing');

      expect(getResearchPrograms(`missing-${randomUUID()}`)).toEqual([]);
      expect(getTestComparison(`missing-${randomUUID()}`)).toBeUndefined();
      expect(analyzeWinnerDelta(`missing-${randomUUID()}`)).toBeNull();
      expect(chiSquaredTest(0, 0, 0, 0)).toEqual({ chiSquared: 0, pValue: 1 });
      expect(chiSquaredTest(0, 0, 5, 0).pValue).toBeGreaterThanOrEqual(0);

      const rawVariantA = createVariant({ product_id: rawProduct.id, name: 'Raw A', content: 'Raw A' });
      const rawVariantB = createVariant({ product_id: rawProduct.id, name: 'Raw B', content: 'Raw B' });
      expect(getResearchPrograms(rawProduct.id)).toEqual([
        { program: 'Raw primary program', variantId: null, variantName: null },
      ]);
      const rawTest = startTest({
        product_id: rawProduct.id,
        variant_a_id: rawVariantA.id,
        variant_b_id: rawVariantB.id,
        min_swipes: 50,
      }).test!;

      const rawComparison = getTestComparison(rawTest.id)!;
      expect(rawComparison.statistics.confidence_tier).toBe('raw');
      expect(rawComparison.statistics.chi_squared).toBeNull();
      expect(rawComparison.statistics.recommended_winner).toBeNull();

      const ciVariantA = createVariant({ product_id: ciProduct.id, name: 'CI A', content: 'CI A' });
      const ciVariantB = createVariant({ product_id: ciProduct.id, name: 'CI B', content: 'CI B' });
      const ciTest = startTest({
        product_id: ciProduct.id,
        variant_a_id: ciVariantA.id,
        variant_b_id: ciVariantB.id,
        min_swipes: 50,
      }).test!;

      const ciIdeaA = insertIdea(ciProduct.id, ciVariantA.id, 'CI idea A');
      const ciIdeaB = insertIdea(ciProduct.id, ciVariantB.id, 'CI idea B');
      for (let i = 0; i < 20; i++) insertSwipe(ciIdeaA, ciProduct.id, 'approve');
      for (let i = 0; i < 20; i++) insertSwipe(ciIdeaB, ciProduct.id, 'reject');

      const ciComparison = getTestComparison(ciTest.id)!;
      expect(ciComparison.statistics.confidence_tier).toBe('ci');
      expect(ciComparison.statistics.significant).toBe(true);
      expect(ciComparison.statistics.recommended_winner).toBeNull();

      const sigVariantA = createVariant({ product_id: significanceProduct.id, name: 'Winner', content: 'Winner content', is_control: true });
      const sigVariantB = createVariant({ product_id: significanceProduct.id, name: 'Loser', content: 'Loser content' });
      const sigTest = startTest({
        product_id: significanceProduct.id,
        variant_a_id: sigVariantA.id,
        variant_b_id: sigVariantB.id,
        min_swipes: 5,
      }).test!;

      const sigIdeaA = insertIdea(significanceProduct.id, sigVariantA.id, 'Sig idea A');
      const sigIdeaB = insertIdea(significanceProduct.id, sigVariantB.id, 'Sig idea B');
      for (let i = 0; i < 5; i++) insertSwipe(sigIdeaA, significanceProduct.id, 'approve');
      for (let i = 0; i < 5; i++) insertSwipe(sigIdeaB, significanceProduct.id, 'reject');

      const sigTaskA = insertTask(significanceProduct.id, sigIdeaA, 'done');
      insertTask(significanceProduct.id, sigIdeaB, 'in_progress');
      insertCostEvent(significanceProduct.id, sigTaskA, 12.34);

      const sigComparison = getTestComparison(sigTest.id)!;
      expect(sigComparison.statistics.confidence_tier).toBe('significance');
      expect(sigComparison.statistics.significant).toBe(true);
      expect(sigComparison.statistics.recommended_winner).toBe(sigVariantA.id);

      expect(analyzeWinnerDelta(sigTest.id)).toBeNull();
      concludeTest(sigTest.id, sigVariantA.id);

      const analysis = analyzeWinnerDelta(sigTest.id);
      expect(analysis).toContain('A/B Test Analysis: Winner vs Loser');
      expect(analysis).toContain('### Statistical Significance');

      const concurrentVariantA = createVariant({ product_id: concurrentProduct.id, name: 'Concurrent A', content: 'Concurrent A' });
      const concurrentVariantB = createVariant({ product_id: concurrentProduct.id, name: 'Concurrent B', content: 'Concurrent B' });
      startTest({
        product_id: concurrentProduct.id,
        variant_a_id: concurrentVariantA.id,
        variant_b_id: concurrentVariantB.id,
        split_mode: 'concurrent',
      });

      expect(getResearchPrograms(concurrentProduct.id)).toEqual([
        { program: 'Concurrent A', variantId: concurrentVariantA.id, variantName: 'Concurrent A' },
        { program: 'Concurrent B', variantId: concurrentVariantB.id, variantName: 'Concurrent B' },
      ]);

      const alternatingVariantA = createVariant({ product_id: alternatingProduct.id, name: 'Alt A', content: 'Alt A' });
      const alternatingVariantB = createVariant({ product_id: alternatingProduct.id, name: 'Alt B', content: 'Alt B' });
      startTest({
        product_id: alternatingProduct.id,
        variant_a_id: alternatingVariantA.id,
        variant_b_id: alternatingVariantB.id,
        split_mode: 'alternating',
      });

      expect(getResearchPrograms(alternatingProduct.id)).toEqual([
        { program: 'Alt A', variantId: alternatingVariantA.id, variantName: 'Alt A' },
      ]);
      expect(getResearchPrograms(alternatingProduct.id)).toEqual([
        { program: 'Alt B', variantId: alternatingVariantB.id, variantName: 'Alt B' },
      ]);
    } finally {
      cleanupProduct(rawProduct.id);
      cleanupProduct(ciProduct.id);
      cleanupProduct(significanceProduct.id);
      cleanupProduct(concurrentProduct.id);
      cleanupProduct(alternatingProduct.id);
    }
  });
});
