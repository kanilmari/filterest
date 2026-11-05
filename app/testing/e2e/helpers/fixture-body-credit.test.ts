// fixture-body-credit.test.ts
// Pins the dataset fixture body-credit declarations without starting Playwright.
// Connects the two opted-in specs to temp-dataset's explicit body-slot contract.
// Prevents hook/helper declarations from changing the wrong timeout slot.
// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const e2eRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const specCounts = new Map([
  ['A_row_crud/A7_fk_dropdown_edit.spec.ts', 4],
  ['A_row_crud/A8_temp_dataset_persistence.spec.ts', 2],
]);
const allowedFiles = new Set([
  'helpers/temp-dataset.ts',
  'helpers/temp-dataset.test.ts',
  'helpers/fixture-body-credit.test.ts',
  ...specCounts.keys(),
]);

// Check names before descending or reading; never follow symlinks into protected scopes.
function excluded(name: string): boolean {
  return /secret|token|password|credential|creds/i.test(name)
    || /\.(key|pem|env)$/i.test(name) || /^\.env/i.test(name)
    || /^(node_modules|keys|\.ssh|\.codex)$/i.test(name) || /^J25/i.test(name);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded(entry.name) || entry.isSymbolicLink()) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(ts|mjs)$/.test(entry.name) ? [path] : [];
  });
}

// Keep offsets/newlines while hiding text whose braces/test tokens are not code.
function maskText(source: string): string {
  return source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g,
    text => text.replace(/[^\n]/g, ' '));
}

function closingDelimiter(code: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < code.length; index += 1) {
    if (code[index] === open) depth += 1;
    if (code[index] === close && --depth === 0) return index;
  }
  throw new Error(`Unmatched ${open} at ${start}`);
}

function enclosingSlot(source: string, offset: number): string | undefined {
  const code = maskText(source);
  const tokens = /\btest\s*(?:\.\s*(beforeEach|afterEach|beforeAll|afterAll)\s*)?\(|\.\s*extend\s*\(/g;
  const enclosing: Array<{ slot: string; start: number }> = [];
  for (const match of code.matchAll(tokens)) {
    const open = match.index! + match[0].lastIndexOf('(');
    const close = closingDelimiter(code, open, '(', ')');
    if (open >= offset || close <= offset) continue;
    const slot = match[0].trimStart().startsWith('.') ? 'extend' : match[1] ?? 'test';
    if (slot === 'extend') {
      enclosing.push({ slot, start: open });
      continue;
    }
    // Only a top-level callback arrow counts, not a destructured parameter or
    // an object in another argument. Both approved specs use block callbacks.
    let bodyStart = -1;
    for (let index = open + 1; index < close; index += 1) {
      if (code[index] === '(') index = closingDelimiter(code, index, '(', ')');
      else if (code[index] === '{') index = closingDelimiter(code, index, '{', '}');
      else if (code.slice(index, index + 2) === '=>') {
        bodyStart = index + 2;
        while (/\s/.test(code[bodyStart] ?? '')) bodyStart += 1;
        break;
      }
    }
    if (bodyStart >= 0 && code[bodyStart] === '{' && bodyStart < offset
      && offset < closingDelimiter(code, bodyStart, '{', '}')) {
      enclosing.push({ slot, start: open });
    }
  }
  return enclosing.sort((left, right) => right.start - left.start)[0]?.slot;
}

describe('fixture body-credit scope', () => {
  it('allows only the six reviewed declarations, all inside test callbacks', () => {
    const counts = new Map<string, number>();
    const failures: string[] = [];
    for (const path of sourceFiles(e2eRoot)) {
      const name = relative(e2eRoot, path).split('\\').join('/');
      const source = readFileSync(path, 'utf8');
      const occurrences = [...source.matchAll(/\bcreditBody\b/g)];
      if (!occurrences.length) continue;
      if (!allowedFiles.has(name)) failures.push(`${name}: body credit is not allowed in this file`);
      if (!specCounts.has(name)) continue;
      counts.set(name, occurrences.length);
      for (const occurrence of occurrences) {
        const offset = occurrence.index!;
        const slot = enclosingSlot(source, offset);
        const line = source.slice(0, offset).split('\n').length;
        if (slot !== 'test') failures.push(`${name}:${line}: body credit must be inside a test callback; found ${slot ?? 'no callback'}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
    expect(counts).toEqual(specCounts);
  });

  it('accepts finally within the body and ignores text containing braces or hook tokens', () => {
    const source = "test('test.beforeEach( {', async ({ page }) => { /* } */ try {} finally { fixture({ creditBody: true }); } });";
    expect(enclosingSlot(source, source.indexOf('creditBody'))).toBe('test');
  });

  it.each(['beforeEach', 'afterEach', 'beforeAll', 'afterAll'])(
    'rejects the nearest enclosing %s even within a test', hook => {
      const source = `test('body', async () => { test.${hook}(async () => { fixture({ creditBody: true }); }); });`;
      expect(enclosingSlot(source, source.indexOf('creditBody'))).toBe(hook);
    },
  );

  it('rejects an extending fixture callback and a declaration outside a callback', () => {
    const source = 'base.extend({ fixture: async () => { fixture({ creditBody: true }); } });';
    expect(enclosingSlot(source, source.indexOf('creditBody'))).toBe('extend');
    const outside = "test('body', { creditBody: true }, async () => {});";
    expect(enclosingSlot(outside, outside.indexOf('creditBody'))).toBeUndefined();
  });
});
