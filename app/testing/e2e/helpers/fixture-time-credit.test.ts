// fixture-time-credit.test.ts
// Pins fixture timeout reservations, measured credit, and concurrent ownership.
// Separates the body's readable limit from the hook slot changed by setTimeout.
// Body-credit cases inject a known slot; live callers cannot identify that slot.
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { withFixtureTimeCredit } from './fixture-time-credit';

function fixture(timeout = 30_000) {
  let time = 0;
  let slot: 'body' | 'hook' = 'body';
  const limits = { body: timeout, hook: timeout };
  const info = {
    get timeout() { return limits.body; },
    status: 'passed' as 'passed' | 'failed', // Playwright also starts the body as passed.
    annotations: [] as Array<{ type: string; description?: string }>,
    setTimeout: vi.fn((value: number) => { limits[slot] = value; }),
  };
  return {
    info, limits, enterSlot: (value: typeof slot) => { slot = value; },
    advance: (ms: number) => { time += ms; },
    options: { now: () => time, getTestInfo: () => info, getExecutionSlot: () => slot },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('fixture time credit', () => {
  it('reserves before a 12 s call and keeps its wall time and return value', async () => {
    const f = fixture(), value = { created: true };
    const result = await withFixtureTimeCredit('create', async () => {
      expect(f.info.timeout).toBe(90_000);
      f.advance(12_000);
      return value;
    }, f.options);
    expect(result).toBe(value);
    expect(f.info.setTimeout.mock.calls).toEqual([[90_000], [42_000]]);
    expect(f.info.annotations).toEqual([{ type: 'fixture-time', description: 'create 12000' }]);
  });

  it('caps a 75 s call at 60 s while annotating its full wall time', async () => {
    const f = fixture();
    await withFixtureTimeCredit('drop', async () => { f.advance(75_000); }, f.options);
    expect(f.info.timeout).toBe(90_000);
    expect(f.info.annotations).toEqual([{ type: 'fixture-time', description: 'drop 75000' }]);
  });

  it('credits and annotates a failed call without replacing its error', async () => {
    const f = fixture(), failure = new Error('fixture failed');
    await expect(withFixtureTimeCredit('cleanup', async () => {
      f.advance(5_000);
      throw failure;
    }, f.options)).rejects.toBe(failure);
    expect(f.info.timeout).toBe(35_000);
    expect(f.info.annotations).toEqual([{ type: 'fixture-time', description: 'cleanup 5000' }]);
  });

  it('credits and annotates only the outer call when calls nest across awaits', async () => {
    const f = fixture();
    await withFixtureTimeCredit('create', async () => {
      f.advance(2_000);
      await Promise.resolve();
      await withFixtureTimeCredit('cleanup', async () => { f.advance(5_000); }, f.options);
      f.advance(3_000);
    }, f.options);
    expect(f.info.setTimeout.mock.calls).toEqual([[90_000], [40_000]]);
    expect(f.info.annotations).toEqual([{ type: 'fixture-time', description: 'create 10000' }]);
  });

  it.each(['first', 'second'] as const)('counts overlapping wall time once when %s finishes first', async first => {
    const f = fixture(), a = deferred(), b = deferred();
    const creating = withFixtureTimeCredit('create', () => a.promise, f.options);
    f.advance(4_000);
    const dropping = withFixtureTimeCredit('drop', () => b.promise, f.options);
    expect(f.info.timeout).toBe(150_000);
    f.advance(6_000);
    if (first === 'first') { a.resolve(); await creating; }
    else { b.resolve(); await dropping; }
    f.advance(5_000);
    a.resolve(); b.resolve();
    await Promise.all([creating, dropping]);
    expect(f.info.timeout).toBe(45_000);
    expect(f.info.annotations).toEqual(first === 'first' ? [
      { type: 'fixture-time', description: 'create 10000' },
      { type: 'fixture-time', description: 'drop 11000' },
    ] : [
      { type: 'fixture-time', description: 'drop 6000' },
      { type: 'fixture-time', description: 'create 15000' },
    ]);
  });

  it('applies each overlapping call\'s cap before combining credited ranges', async () => {
    const f = fixture(), a = deferred(), b = deferred();
    const creating = withFixtureTimeCredit('create', () => a.promise, f.options);
    f.advance(50_000);
    const dropping = withFixtureTimeCredit('drop', () => b.promise, f.options);
    f.advance(25_000);
    a.resolve(); await creating;
    f.advance(50_000);
    b.resolve(); await dropping;
    // [0, 60 s] and [50 s, 110 s] have a 110 s union, not 120 s.
    expect(f.info.timeout).toBe(140_000);
    expect(f.info.annotations).toEqual([
      { type: 'fixture-time', description: 'create 75000' },
      { type: 'fixture-time', description: 'drop 75000' },
    ]);
  });

  it('keeps simultaneous tests independent, including nested calls for another test', async () => {
    const a = fixture(), b = fixture();
    await withFixtureTimeCredit('create', async () => {
      await withFixtureTimeCredit('drop', async () => { b.advance(5_000); }, b.options);
      a.advance(12_000);
    }, a.options);
    expect(a.info.timeout).toBe(42_000);
    expect(b.info.timeout).toBe(35_000);
    expect(a.info.annotations).toEqual([{ type: 'fixture-time', description: 'create 12000' }]);
    expect(b.info.annotations).toEqual([{ type: 'fixture-time', description: 'drop 5000' }]);
  });

  it('runs unchanged when the test-info lookup throws', async () => {
    const f = fixture();
    const result = await withFixtureTimeCredit('create', async () => { f.advance(12_000); return 17; }, {
      ...f.options, getTestInfo: () => { throw new Error('No running test'); },
    });
    expect(result).toBe(17);
    expect(f.info.timeout).toBe(30_000);
    expect(f.info.setTimeout).not.toHaveBeenCalled();
    expect(f.info.annotations).toEqual([]);
  });

  it('is invisible with the real lookup outside Playwright', async () => {
    await expect(withFixtureTimeCredit('create', async () => 17)).resolves.toBe(17);
  });

  it('leaves an unlimited test unchanged', async () => {
    const f = fixture(0);
    await withFixtureTimeCredit('drop', async () => { f.advance(12_000); }, f.options);
    expect(f.info.timeout).toBe(0);
    expect(f.info.setTimeout).not.toHaveBeenCalled();
    expect(f.info.annotations).toEqual([]);
  });

  it.each(['relative', 'absolute'])('preserves a spec-owned %s timeout change', async mode => {
    const f = fixture();
    await withFixtureTimeCredit('create', async () => {
      f.info.setTimeout(mode === 'relative' ? f.info.timeout + 90_000 : 180_000);
      f.advance(12_000);
    }, f.options);
    expect(f.info.timeout).toBe(132_000);
  });

  it('keeps a test unlimited if its spec disables the timeout during a fixture', async () => {
    const f = fixture();
    await withFixtureTimeCredit('create', async () => {
      f.info.setTimeout(0);
      f.advance(12_000);
    }, f.options);
    expect(f.info.timeout).toBe(0);
    expect(f.info.setTimeout.mock.calls).toEqual([[90_000], [0]]);
  });

  it('does not swallow errors from the test-info methods', async () => {
    const f = fixture(), failure = new Error('cannot change timeout'), run = vi.fn();
    f.info.setTimeout.mockImplementationOnce(() => { throw failure; });
    await expect(withFixtureTimeCredit('create', run, f.options)).rejects.toBe(failure);
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps sequential credits instead of restoring an earlier limit', async () => {
    const f = fixture();
    await withFixtureTimeCredit('create', async () => { f.advance(12_000); }, f.options);
    await withFixtureTimeCredit('drop', async () => { f.advance(5_000); }, f.options);
    expect(f.info.setTimeout.mock.calls).toEqual([[90_000], [42_000], [102_000], [47_000]]);
    expect(f.info.annotations).toHaveLength(2);
  });

  it.each(['passed', 'failed'] as const)('leaves afterEach limits intact after a %s body', async status => {
    for (const allowance of [0, 90_000]) {
      for (const fails of [false, true]) {
        const f = fixture(), failure = new Error('cleanup failed');
        f.info.status = status;
        f.enterSlot('hook');
        if (allowance) f.info.setTimeout(f.info.timeout + allowance); // Teardown's existing +90 s.
        expect(f.info.timeout).toBe(30_000); // Getter still reads the body, not the active hook.
        const before = f.limits.hook;
        f.info.setTimeout.mockClear();
        const cleanup = withFixtureTimeCredit('cleanup', async () => {
          f.advance(5_000);
          if (fails) throw failure;
        }, { ...f.options, getExecutionSlot: undefined }); // Exercise the live unknown-slot fallback.
        if (fails) await expect(cleanup).rejects.toBe(failure);
        else await cleanup;
        expect(f.limits).toEqual({ body: 30_000, hook: before });
        expect(f.info.setTimeout).not.toHaveBeenCalled();
        expect(f.info.annotations).toEqual([{
          type: 'fixture-time',
          description: 'cleanup 5000 credited: 0; reason: public API cannot distinguish test body from hooks',
        }]);
      }
    }
  });

  it('does not overwrite an allowance added during cleanup in a known hook', async () => {
    const f = fixture();
    f.enterSlot('hook');
    await withFixtureTimeCredit('cleanup', async () => {
      f.info.setTimeout(f.info.timeout + 90_000);
      f.advance(5_000);
    }, f.options);
    expect(f.limits).toEqual({ body: 30_000, hook: 120_000 });
    expect(f.info.setTimeout.mock.calls).toEqual([[120_000]]);
    expect(f.info.annotations).toEqual([{
      type: 'fixture-time', description: 'cleanup 5000 credited: 0; reason: active hook limit is not publicly readable',
    }]);
  });

  it.each(['create', 'drop', 'cleanup'] as const)('gives live %s calls no credit even in the body', async label => {
    for (const fails of [false, true]) {
      const f = fixture(), failure = new Error('fixture failed');
      const call = withFixtureTimeCredit(label, async () => {
        f.advance(12_000);
        if (fails) throw failure;
        return 17;
      }, { ...f.options, getExecutionSlot: undefined });
      if (fails) await expect(call).rejects.toBe(failure);
      else await expect(call).resolves.toBe(17);
      expect(f.limits).toEqual({ body: 30_000, hook: 30_000 });
      expect(f.info.setTimeout).not.toHaveBeenCalled();
      expect(f.info.annotations).toEqual([{
        type: 'fixture-time',
        description: `${label} 12000 credited: 0; reason: public API cannot distinguish test body from hooks`,
      }]);
    }
  });

  it('suppresses nested annotations in the live no-credit fallback', async () => {
    const f = fixture(), options = { ...f.options, getExecutionSlot: undefined };
    await withFixtureTimeCredit('create', async () => {
      f.advance(2_000);
      await withFixtureTimeCredit('cleanup', async () => { f.advance(5_000); }, options);
    }, options);
    expect(f.info.setTimeout).not.toHaveBeenCalled();
    expect(f.info.annotations).toEqual([{
      type: 'fixture-time',
      description: 'create 7000 credited: 0; reason: public API cannot distinguish test body from hooks',
    }]);
  });

  it('annotates hook cleanup even when the body is unlimited', async () => {
    const f = fixture(0);
    f.enterSlot('hook');
    f.info.setTimeout(120_000);
    f.info.setTimeout.mockClear();
    await withFixtureTimeCredit('cleanup', async () => { f.advance(5_000); }, f.options);
    expect(f.limits).toEqual({ body: 0, hook: 120_000 });
    expect(f.info.setTimeout).not.toHaveBeenCalled();
    expect(f.info.annotations).toEqual([{
      type: 'fixture-time', description: 'cleanup 5000 credited: 0; reason: active hook limit is not publicly readable',
    }]);
  });
});
