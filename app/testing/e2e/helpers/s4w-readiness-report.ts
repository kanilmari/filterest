// s4w-readiness-report.ts
// Observes readiness alongside the two unchanged shared E2E pauses (WO69 S4w).
// Connects read-only product signals, Playwright test identity and JSONL artifacts.
// Reporting must never become a prerequisite for a helper's success or completion.
import { test, type Page } from '@playwright/test';
import { mkdir, open } from 'node:fs/promises';
import * as path from 'node:path';
import { resolveFilterestTestRuntimePaths } from './test-runtime-paths';

type Helper = 'login' | 'waitForDataLoaded';
export type ReadinessRecord = {
  helper: Helper;
  conditionId: string;
  trueAtStart: boolean;
  msToTrue: number | null;
  fixedWaitMs: number;
  specFile: string | null;
  testTitle: string | null;
  workerIndex: number | null;
  probeErrors: number;
  probeIncomplete: boolean;
};

/** One O_APPEND write per complete line; independent workers share no buffers. */
export async function appendReadinessRecord(directory: string, record: ReadinessRecord): Promise<void> {
  try {
    await mkdir(directory, { recursive: true });
    const file = await open(path.join(directory, 's4w_readiness.jsonl'), 'a');
    try {
      await file.write(`${JSON.stringify(record)}\n`);
    } finally {
      await file.close();
    }
  } catch { /* Unavailable reporting storage cannot change a test's outcome. */ }
}

// The record names no project: a shared helper that reads one would tie every spec
// using it to the project matrix (test_e2e_matrix_reduction.py).
function reportDirectory() {
  return process.env.E2E_LOGDIR || resolveFilterestTestRuntimePaths().playwrightResults;
}

function reportContext() {
  try {
    const info = test.info();
    return {
      directory: reportDirectory(),
      specFile: path.relative(info.config.rootDir, info.file),
      testTitle: info.title,
      workerIndex: info.workerIndex,
    };
  } catch {
    // Global setup has no TestInfo. Keep its absence explicit, without inventing a test.
    return { directory: reportDirectory(), specFile: null, testTitle: null, workerIndex: null };
  }
}

/** Serialized into the page: return only a boolean, never content or identity. */
export function readReadinessCondition({ helper, tableName }: { helper: Helper; tableName?: string }): boolean {
  if (helper === 'login') {
    // main.js calls ready() after bootstrap + translation; shell_boot_recovery.js
    // exposes status(). Read status, never call the state-changing ready() handshake.
    const boot = (window as unknown as {
      __filterestShellBoot?: { status(): { ready: boolean; revealed: boolean } };
    }).__filterestShellBoot?.status();
    return boot?.ready === true && boot.revealed === true;
  }
  // Candidate, not a universal loaded contract: dataset_view_printer.js commits
  // this surface after awaiting its renderer (also for zero rows). Retained results
  // can predate a refresh; extension/Home views have different lifecycle markers.
  const selected = tableName || sessionStorage.getItem('selected_dataset');
  if (!selected) return false;
  const parts = document.getElementById(`${selected}_tab_parts_container`);
  if (!parts) return false;
  return [...parts.querySelectorAll<HTMLElement>('.scrollable_content')].some(container => {
    const style = getComputedStyle(container);
    return style.display !== 'none' && style.visibility !== 'hidden'
      && container.getClientRects().length > 0
      && container.querySelector(':scope > .dataset-results-surface') !== null;
  });
}

/**
 * Start immediately before the existing pause and finish in its finally block.
 * Neither the probe nor the append is awaited. Slow/hung evaluations cannot
 * extend the pause, and late results cannot update an already emitted record.
 */
export function beginReadinessReport(page: Page, helper: Helper, fixedWaitMs: number, tableName?: string): () => void {
  try {
    const { directory, ...identity } = reportContext();
    const record: ReadinessRecord = {
      helper,
      conditionId: helper === 'login' ? 'shell-ready-revealed-v1' : 'candidate-selected-results-committed-v1',
      trueAtStart: false, msToTrue: null, fixedWaitMs, ...identity,
      probeErrors: 0, probeIncomplete: false,
    };
    const started = performance.now();
    let stopped = false;
    let inFlight = 0;
    let first = true;
    let timer: ReturnType<typeof setInterval>;
    const poll = async () => {
      // Keep the 25 ms sampling cadence even if an earlier transport read is slow.
      // The fixed window bounds this to at most twenty evaluations per call.
      if (stopped) return;
      if (performance.now() - started >= fixedWaitMs) { clearInterval(timer); return; }
      inFlight += 1;
      const atStart = first;
      first = false;
      try {
        const ready = await page.evaluate(readReadinessCondition, { helper, tableName });
        const elapsed = performance.now() - started;
        if (!stopped && elapsed < fixedWaitMs && ready === true
            && (record.msToTrue === null || atStart)) {
          record.trueAtStart = atStart;
          record.msToTrue = atStart ? 0 : Math.round(elapsed * 100) / 100;
          clearInterval(timer);
        }
      } catch {
        // Never persist error messages/stacks, or observations after the window.
        if (!stopped && performance.now() - started < fixedWaitMs) record.probeErrors += 1;
      } finally {
        inFlight -= 1;
      }
    };
    timer = setInterval(() => { void poll(); }, 25);
    void poll();
    return () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      record.probeIncomplete = inFlight > 0;
      void appendReadinessRecord(directory, { ...record });
    };
  } catch {
    return () => {}; // Even unavailable test metadata must not affect the helper.
  }
}
