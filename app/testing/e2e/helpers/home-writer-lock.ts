// home-writer-lock.ts
// Excludes real Home writers across Playwright worker processes, per server origin.
// Connects snapshot/cleanup lifetimes with owner-only temporary filesystem locks.
// Refcounts nested snapshots and reclaims dead owners without waiting or stealing live locks.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

type Owner = { pid: number; started: string; label: string; identity: string };
export type HomeWriterLease = { path: string; release: () => void; retain: () => HomeWriterLease };

/** Only ESRCH proves death; EPERM still means a live owner. */
export function homeWriterProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    throw error;
  }
}

/** Injectable process identity/temp root allow cross-owner proofs without a server. */
export function createHomeWriterLock({ directory = tmpdir(), pid = process.pid,
  isAlive = homeWriterProcessAlive } = {}) {
  const held = new Map<string, { owner: Owner; ownerPath: string; references: number }>();

  return function acquire(origin: string, label = 'real-writing Home spec'): HomeWriterLease {
    origin = new URL(origin).origin;
    const path = `${directory}/filterest-home-writer-${createHash('sha256').update(origin).digest('hex')}.lock`;
    let current = held.get(path);
    if (!current) {
      const owner: Owner = { pid, started: new Date().toISOString(), label, identity: randomUUID() };
      const filename = `owner-${pid}-${owner.identity}.json`;
      const ownerPath = `${path}/${filename}`;
      const prepared = `${path}.${owner.identity}`;
      fs.mkdirSync(prepared, { mode: 0o700 });
      let acquired = false;
      try {
        const descriptor = fs.openSync(`${prepared}/${filename}`, 'wx', 0o600);
        try { fs.writeFileSync(descriptor, JSON.stringify(owner)); }
        finally { fs.closeSync(descriptor); }
        // Publish a complete nonempty directory atomically: rename cannot replace
        // another nonempty lock. SIGKILL during preparation leaves no blocking
        // partial lock. Unique owner filenames also prevent stale-recovery ABA.
        for (let attempt = 0; ; attempt++) {
          try { fs.renameSync(prepared, path); acquired = true; break; }
          catch (error) {
            if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
            const entries = fs.readdirSync(path);
            const match = entries.length === 1 && /^owner-([1-9]\d*)-([\da-f-]+)\.json$/.exec(entries[0]);
            if (!match) throw new Error(`Invalid Home writer lock against ${origin}; run real-writing Home specs with one worker (lock: ${path})`);
            const ownerPid = Number(match[1]);
            const holder = JSON.parse(fs.readFileSync(`${path}/${entries[0]}`, 'utf8')) as Owner;
            if (isAlive(ownerPid) || attempt !== 0) {
              throw new Error(`Another real-writing Home spec (pid ${ownerPid}, ${JSON.stringify(holder.label)}) is running against ${origin}; run real-writing Home specs with one worker (lock: ${path})`);
            }
            // Only the contender that removes this exact dead owner's filename
            // can retire its directory. A newer nonempty lock is never removed.
            try { fs.unlinkSync(`${path}/${entries[0]}`); }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
              throw error;
            }
            try { fs.rmdirSync(path); }
            catch (error) {
              if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
            }
            // One atomic retry, never a wait that consumes the cleanup budget.
          }
        }
      } finally {
        if (!acquired) fs.rmSync(prepared, { recursive: true, force: true });
      }
      current = { owner, ownerPath, references: 0 };
      held.set(path, current);
    }
    current.references++;
    const entry = current;
    let released = false;
    return { path, retain: () => acquire(origin, label), release: () => {
      if (released) return;
      released = true;
      if (--entry.references !== 0) return;
      held.delete(path);
      // Check PID and per-acquisition identity, including when a file was replaced.
      // Never unlink a foreign owner or remove a directory whose owner was not ours.
      try {
        const owner = JSON.parse(fs.readFileSync(entry.ownerPath, 'utf8')) as Owner;
        if (owner.pid !== pid || owner.identity !== entry.owner.identity) return;
        fs.unlinkSync(entry.ownerPath);
        fs.rmdirSync(path);
      } catch (error) {
        // A prepared contender may publish after our owner file is removed.
        if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    } };
  };
}

export const acquireHomeWriter = createHomeWriterLock();
