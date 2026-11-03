// fixture-time-credit.ts
// Measures dataset fixture wall time without guessing Playwright's active slot.
// Connects temp-dataset calls to timeout adjustments and fixture-time annotations.
// Keeps nested/overlapping work from counting the same milliseconds twice.
import { AsyncLocalStorage } from 'node:async_hooks';
import { test, type TestInfo } from '@playwright/test';

type FixtureTestInfo = Pick<TestInfo, 'timeout' | 'setTimeout' | 'annotations'>;
type CreditRange = { start: number; end: number };
type CreditState = { active: number; ranges: CreditRange[] };
type CreditScope = { info: FixtureTestInfo; active: boolean };
type ExecutionSlot = 'body' | 'hook' | 'unknown';
type CreditOptions = {
  now?: () => number;
  getTestInfo?: () => FixtureTestInfo;
  // Test seam: neither supported Playwright version publicly exposes this.
  // Live callers must remain unknown until a documented detector is available.
  getExecutionSlot?: () => ExecutionSlot;
};

const CAP_MS = 60_000;
const scopes = new AsyncLocalStorage<CreditScope>();
const credits = new WeakMap<FixtureTestInfo, CreditState>();

/** Keep disjoint ranges so completion order cannot credit overlapping time twice. */
function addRange(state: CreditState, start: number, end: number): number {
  let added = end - start;
  const merged = { start, end };
  const ranges: CreditRange[] = [];
  for (const range of state.ranges) {
    added -= Math.max(0, Math.min(end, range.end) - Math.max(start, range.start));
    if (range.end < merged.start || range.start > merged.end) ranges.push(range);
    else {
      merged.start = Math.min(merged.start, range.start);
      merged.end = Math.max(merged.end, range.end);
    }
  }
  state.ranges = [...ranges, merged].sort((left, right) => left.start - right.start);
  return added;
}

export async function withFixtureTimeCredit<T>(
  label: 'create' | 'drop' | 'cleanup',
  run: () => Promise<T>,
  {
    now = () => performance.now(), getTestInfo = () => test.info(),
    getExecutionSlot = () => 'unknown',
  }: CreditOptions = {},
): Promise<T> {
  let info: FixtureTestInfo;
  try {
    info = getTestInfo();
  } catch {
    // Only the test-info lookup is optional outside Playwright's test runner.
    return run();
  }
  const parent = scopes.getStore();
  if (parent?.info === info && parent.active) return run();
  const slot = getExecutionSlot();
  const canCredit = slot === 'body';
  if (canCredit && info.timeout === 0) return run();

  // timeout reads the body's default slot, but setTimeout writes the active
  // slot. No public hook-limit getter or body/hook discriminator exists in
  // Playwright 1.56.1/1.60.0. Live calls therefore receive no credit anywhere.
  const state = canCredit ? credits.get(info) ?? { active: 0, ranges: [] } : undefined;
  const scope = { info, active: true };
  if (state) info.setTimeout(info.timeout + CAP_MS); // Reserve only a proven body slot.
  const start = now();
  if (state) {
    state.active += 1;
    credits.set(info, state);
  }
  try {
    return await scopes.run(scope, run);
  } finally {
    const elapsed = Math.max(0, now() - start);
    scope.active = false;
    if (state) {
      const added = addRange(state, start, start + Math.min(elapsed, CAP_MS));
      state.active -= 1;
      if (state.active === 0) credits.delete(info);
      // Adjust the proven body limit; preserve relative spec-owned changes.
      // A spec that disables its limit while awaiting the fixture stays unlimited.
      if (info.timeout !== 0) info.setTimeout(info.timeout - CAP_MS + added);
    }
    const reason = slot === 'hook'
      ? 'active hook limit is not publicly readable'
      : 'public API cannot distinguish test body from hooks';
    info.annotations.push({
      type: 'fixture-time',
      description: `${label} ${Math.round(elapsed)}${canCredit ? '' : ` credited: 0; reason: ${reason}`}`,
    });
  }
}
