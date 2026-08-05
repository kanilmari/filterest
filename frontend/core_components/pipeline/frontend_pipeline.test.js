// frontend_pipeline.test.js
// Verifies the generic frontend pipeline runner and its small factory helpers.
// Bridges staged pipeline definitions and mutable runtime context with direct unit tests.
// Exists to keep pipeline skip, abort, and binding semantics stable across call sites.

import { describe, test, expect, vi } from 'vitest';
import { runPipeline, createPipeline, createStage } from './frontend_pipeline.js';

describe('runPipeline', () => {
  test('runs stages in order against a shared context', async () => {
    const calls = [];
    const context = { value: 1 };
    const stages = [
      createStage('first', async (ctx) => {
        calls.push('first');
        ctx.value += 1;
      }),
      createStage('second', async (ctx) => {
        calls.push('second');
        ctx.value *= 3;
      }),
    ];

    const result = await runPipeline(stages, context);

    expect(calls).toEqual(['first', 'second']);
    expect(result).toBe(context);
    expect(context.value).toBe(6);
  });

  test('skips requested stages unless they are always enforced', async () => {
    const skipped = vi.fn();
    const enforced = vi.fn();

    await runPipeline(
      [
        createStage('skipMe', skipped),
        createStage('runAnyway', enforced, true),
      ],
      { skip: ['skipMe', 'runAnyway'] }
    );

    expect(skipped).not.toHaveBeenCalled();
    expect(enforced).toHaveBeenCalledTimes(1);
  });

  test('returns abort result and stops later stages', async () => {
    const afterAbort = vi.fn();
    const abortResult = { abort: true, reason: 'stop_here' };

    const result = await runPipeline(
      [
        createStage('aborter', async () => abortResult),
        createStage('afterAbort', afterAbort),
      ],
      {}
    );

    expect(result).toBe(abortResult);
    expect(afterAbort).not.toHaveBeenCalled();
  });
});

describe('createPipeline', () => {
  test('binds stages into a reusable runner', async () => {
    const runner = createPipeline([
      createStage('increment', (ctx) => {
        ctx.count += 1;
      }),
    ]);

    const context = { count: 0 };
    const result = await runner(context);

    expect(result.count).toBe(1);
  });
});

describe('createStage', () => {
  test('defaults alwaysEnforced to false', () => {
    const stage = createStage('example', () => {});
    expect(stage).toEqual({
      name: 'example',
      fn: expect.any(Function),
      alwaysEnforced: false,
    });
  });
});
