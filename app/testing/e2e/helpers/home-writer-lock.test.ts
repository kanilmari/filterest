// home-writer-lock.test.ts
// Proves cross-owner exclusion, refcounts and safe stale-owner recovery.
// Uses isolated temporary directories and simulated PIDs, without requests or a server.
// Protects the owner's Home from overlapping workers and foreign-lock deletion.
import { afterEach, expect, test, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { createHomeWriterLock, homeWriterProcessAlive } from './home-writer-lock';

vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>() }));

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function owners() {
  const directory = fs.mkdtempSync(`${tmpdir()}/home-writer-unit-`);
  directories.push(directory);
  const alive = new Set([101, 202]);
  return { directory, alive,
    first: createHomeWriterLock({ directory, pid: 101, isAlive: pid => alive.has(pid) }),
    second: createHomeWriterLock({ directory, pid: 202, isAlive: pid => alive.has(pid) }) };
}
const origin = 'https://home.invalid:8100';

test('a live foreign owner fails fast, naming PID/title/origin/path before any request', () => {
  const f = owners();
  const lease = f.first(origin, 'T16 palette');
  const request = vi.fn();
  try {
    expect(() => { f.second(origin, 'T17 buttons'); request(); }).toThrow(
      `Another real-writing Home spec (pid 101, "T16 palette") is running against ${origin}; run real-writing Home specs with one worker (lock: ${lease.path})`);
    expect(request).not.toHaveBeenCalled();
    const owner = JSON.parse(fs.readFileSync(`${lease.path}/${fs.readdirSync(lease.path)[0]}`, 'utf8'));
    expect(owner).toMatchObject({ pid: 101, label: 'T16 palette' });
    expect(Number.isNaN(Date.parse(owner.started))).toBe(false);
  } finally { lease.release(); }
});

test('re-entrant snapshots refcount; releases are idempotent and only the last unlocks', () => {
  const f = owners();
  const first = f.first(origin), nested = f.first(`${origin}/api/admin/front-page`), hook = first.retain();
  first.release(); first.release(); nested.release();
  expect(() => f.second(origin)).toThrow('pid 101');
  hook.release();
  const next = f.second(origin);
  next.release();
  expect(fs.existsSync(first.path)).toBe(false);
});

test('different server origins have independent locks', () => {
  const f = owners();
  const a = f.first(origin), b = f.second('https://other.invalid:8100');
  expect(a.path).not.toBe(b.path);
  a.release(); b.release();
});

test('a dead PID is recovered with one atomic retry; its later release cannot delete the new lock', () => {
  const f = owners();
  const old = f.first(origin);
  f.alive.delete(101);
  const publish = vi.spyOn(fs, 'renameSync');
  const recovered = f.second(origin);
  expect(publish).toHaveBeenCalledTimes(2); // First collision, then one atomic retry.
  old.release();
  expect(fs.existsSync(recovered.path)).toBe(true);
  expect(() => createHomeWriterLock({ directory: f.directory, pid: 303, isAlive: () => true })(origin)).toThrow('pid 202');
  recovered.release();
});

test('release checks PID even if a foreign owner replaced our metadata at the same path', () => {
  const f = owners(); const lease = f.first(origin);
  const file = `${lease.path}/${fs.readdirSync(lease.path)[0]}`;
  const foreign = { ...JSON.parse(fs.readFileSync(file, 'utf8')), pid: 202 };
  fs.writeFileSync(file, JSON.stringify(foreign));
  lease.release();
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(foreign);
});

test('a new writer published during the final release keeps its lock intact', () => {
  const f = owners(); const old = f.first(origin);
  let next: ReturnType<typeof f.second> | undefined;
  const rmdir = fs.rmdirSync;
  vi.spyOn(fs, 'rmdirSync').mockImplementationOnce(path => {
    // The old owner file is gone; a fully prepared new lock replaces the empty directory.
    next = f.second(origin);
    rmdir(path); // ENOTEMPTY, which the outgoing owner must leave intact.
  });
  expect(() => old.release()).not.toThrow();
  expect(fs.existsSync(next!.path)).toBe(true);
  expect(() => f.first(origin)).toThrow('pid 202');
  next!.release();
});

test('only the contender that removes the exact stale owner can retry acquisition', () => {
  const f = owners(); const old = f.first(origin); f.alive.delete(101);
  let recovered: ReturnType<typeof f.second> | undefined;
  const realUnlink = fs.unlinkSync;
  vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(file => {
    // Another process wins stale recovery between this contender's read and unlink.
    recovered = f.second(origin);
    realUnlink(file); // ENOENT for the old unique filename, never the new owner.
  });
  expect(() => createHomeWriterLock({ directory: f.directory, pid: 303, isAlive: () => false })(origin)).toThrow();
  expect(fs.existsSync(recovered!.path)).toBe(true);
  old.release(); recovered!.release();
});

test('ESRCH is dead, EPERM is live and other process-probe errors fail closed', () => {
  const kill = vi.spyOn(process, 'kill');
  kill.mockImplementationOnce(() => { throw Object.assign(new Error(), { code: 'ESRCH' }); });
  expect(homeWriterProcessAlive(101)).toBe(false);
  kill.mockImplementationOnce(() => { throw Object.assign(new Error(), { code: 'EPERM' }); });
  expect(homeWriterProcessAlive(101)).toBe(true);
  kill.mockImplementationOnce(() => { throw Object.assign(new Error('probe failed'), { code: 'EINVAL' }); });
  expect(() => homeWriterProcessAlive(101)).toThrow('probe failed');
});

test('failed owner metadata creation releases the acquisition', () => {
  const f = owners();
  vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw new Error('disk full'); });
  expect(() => f.first(origin)).toThrow('disk full');
  expect(fs.readdirSync(f.directory)).toEqual([]); // No partial published lock or candidate.
  const next = f.second(origin); next.release();
});
