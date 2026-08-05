/** Exact, atomic E2E artifact ownership shared by setup, workers, and teardown. */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
export type TestArtifactKind = 'dataset' | 'folder';
export type TestArtifactStatus = 'planned' | 'confirmed';
type StoredArtifactRun = { version: 1; runId: string; pid: number; processNonce: string; startedAt: string };
type StoredTestArtifact = {
  version: 1;
  runId: string;
  kind: TestArtifactKind;
  name: string;
  status: TestArtifactStatus;
  serverId: number | null;
  registeredAt: string;
  registeredByPid: number;
  confirmedAt: string | null;
};
export type CurrentArtifactRun = StoredArtifactRun & { isPidActive: boolean };
export type RegisteredTestArtifact = StoredTestArtifact;
export type InitializeArtifactRunRegistryOptions = {
  rootDirectory?: string;
  runId?: string;
  pid?: number;
  now?: Date;
};
const REGISTRY_ROOT_ENV = 'EASELECT_E2E_ARTIFACT_REGISTRY_ROOT';
const CURRENT_RUN_FILE_NAME = 'current-run.json';
const RUN_DESCRIPTOR_FILE_NAME = 'run.json';
const ARTIFACT_DIRECTORY_NAME = 'artifacts';
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{5,127}$/;
const ARTIFACT_KINDS: TestArtifactKind[] = ['dataset', 'folder'];
const MAX_ARTIFACT_NAME_LENGTH = 512;
const PROCESS_NONCE_PATTERN = /^[a-f0-9]{64}$/;
const PROCESS_NONCE = crypto.randomBytes(32).toString('hex');
let configuredRootDirectory: string | null = null;

function resolveRegistryRoot(rootDirectory?: string): string {
  if (rootDirectory) {
    configuredRootDirectory = path.resolve(rootDirectory);
  }
  if (configuredRootDirectory) {
    return configuredRootDirectory;
  }
  const environmentRoot = process.env[REGISTRY_ROOT_ENV]?.trim();
  if (environmentRoot) {
    return path.resolve(environmentRoot);
  }
  return path.resolve(process.cwd(), 'testing/e2e/.auth/artifact-runs');
}
function currentRunFilePath(registryRoot: string): string {
  return path.join(registryRoot, CURRENT_RUN_FILE_NAME);
}
function runDirectoryPath(registryRoot: string, runId: string): string {
  assertValidRunId(runId);
  return path.join(registryRoot, runId);
}
function runDescriptorFilePath(registryRoot: string, runId: string): string {
  return path.join(runDirectoryPath(registryRoot, runId), RUN_DESCRIPTOR_FILE_NAME);
}
function artifactDirectoryPath(
  registryRoot: string,
  runId: string,
  kind: TestArtifactKind,
): string {
  assertValidArtifactKind(kind);
  return path.join(runDirectoryPath(registryRoot, runId), ARTIFACT_DIRECTORY_NAME, kind);
}
function artifactEntryFilePath(
  registryRoot: string,
  runId: string,
  kind: TestArtifactKind,
  name: string,
): string {
  const digest = crypto.createHash('sha256').update(`${kind}\0${name}`, 'utf8').digest('hex');
  return path.join(artifactDirectoryPath(registryRoot, runId, kind), `${digest}.json`);
}

function assertValidRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(String(runId ?? ''))) {
    throw new Error(`Invalid E2E artifact run id: ${JSON.stringify(runId)}`);
  }
}

function assertValidArtifactKind(kind: TestArtifactKind): void {
  if (!ARTIFACT_KINDS.includes(kind)) {
    throw new Error(`Invalid E2E artifact kind: ${JSON.stringify(kind)}`);
  }
}

function assertValidArtifactName(name: string): void {
  if (
    typeof name !== 'string'
    || name.trim() === ''
    || name.length > MAX_ARTIFACT_NAME_LENGTH
    || name.includes('\0')
  ) {
    throw new Error(`Invalid E2E artifact name: ${JSON.stringify(name)}`);
  }
}

function readJsonFileFailClosed(filePath: string, description: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${description} at ${filePath}`, { cause: error });
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Corrupt ${description} at ${filePath}`, { cause: error });
  }
}

function validateStoredRun(value: unknown, description: string): StoredArtifactRun {
  const candidate = value as Partial<StoredArtifactRun> | null;
  if (
    !candidate
    || candidate.version !== 1
    || typeof candidate.runId !== 'string'
    || typeof candidate.pid !== 'number'
    || !Number.isSafeInteger(candidate.pid)
    || candidate.pid <= 0
    || typeof candidate.processNonce !== 'string' || !PROCESS_NONCE_PATTERN.test(candidate.processNonce)
    || typeof candidate.startedAt !== 'string'
    || !Number.isFinite(Date.parse(candidate.startedAt))
  ) {
    throw new Error(`Invalid ${description}`);
  }
  assertValidRunId(candidate.runId);
  return candidate as StoredArtifactRun;
}

function validateStoredArtifact(
  value: unknown,
  expectedRunId: string,
  expectedKind: TestArtifactKind,
  description: string,
): StoredTestArtifact {
  const candidate = value as Partial<StoredTestArtifact> | null;
  if (
    !candidate
    || candidate.version !== 1
    || candidate.runId !== expectedRunId
    || candidate.kind !== expectedKind
    || typeof candidate.name !== 'string'
    || (candidate.status !== 'planned' && candidate.status !== 'confirmed')
    || (
      candidate.serverId !== null
      && (
        typeof candidate.serverId !== 'number'
        || !Number.isSafeInteger(candidate.serverId)
        || candidate.serverId <= 0
      )
    )
    || typeof candidate.registeredAt !== 'string'
    || !Number.isFinite(Date.parse(candidate.registeredAt))
    || typeof candidate.registeredByPid !== 'number'
    || !Number.isSafeInteger(candidate.registeredByPid)
    || candidate.registeredByPid <= 0
    || (
      candidate.confirmedAt !== null
      && (
        typeof candidate.confirmedAt !== 'string'
        || !Number.isFinite(Date.parse(candidate.confirmedAt))
      )
    )
  ) {
    throw new Error(`Invalid ${description}`);
  }
  assertValidArtifactName(candidate.name);
  if (candidate.status === 'planned' && (candidate.serverId !== null || candidate.confirmedAt !== null)) {
    throw new Error(`Invalid planned ${description}`);
  }
  if (candidate.status === 'confirmed' && candidate.confirmedAt === null) {
    throw new Error(`Invalid confirmed ${description}`);
  }
  if (candidate.status === 'confirmed' && candidate.serverId === null) {
    throw new Error(`Confirmed artifact is missing serverId in ${description}`);
  }
  return candidate as StoredTestArtifact;
}

function readRunDescriptor(registryRoot: string, runId: string): StoredArtifactRun {
  const descriptorPath = runDescriptorFilePath(registryRoot, runId);
  const run = validateStoredRun(
    readJsonFileFailClosed(descriptorPath, 'E2E artifact run descriptor'),
    `E2E artifact run descriptor at ${descriptorPath}`,
  );
  if (run.runId !== runId) {
    throw new Error(
      `E2E artifact run descriptor mismatch: directory=${runId}, descriptor=${run.runId}`,
    );
  }
  return run;
}

function isProcessActive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'EPERM') {
      return true;
    }
    if (code === 'ESRCH') {
      return false;
    }
    throw new Error(`Could not determine whether E2E artifact registry PID ${pid} is active`, {
      cause: error,
    });
  }
}

function assertCurrentPointerMatchesDescriptor(
  pointer: StoredArtifactRun,
  descriptor: StoredArtifactRun,
): void {
  if (
    pointer.runId !== descriptor.runId
    || pointer.pid !== descriptor.pid
    || pointer.processNonce !== descriptor.processNonce
    || pointer.startedAt !== descriptor.startedAt
  ) {
    throw new Error(
      `E2E artifact current-run pointer does not match run descriptor for ${pointer.runId}`,
    );
  }
}

function writeJsonFileExclusively(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

function publishJsonFileAtomically(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.tmp-${process.pid}-${crypto.randomUUID()}`);
  writeJsonFileExclusively(temporaryPath, value);
  try {
    fs.linkSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function replaceJsonFileAtomically(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.tmp-${process.pid}-${crypto.randomUUID()}`);
  writeJsonFileExclusively(temporaryPath, value);
  try {
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function withExclusiveArtifactEntryLock<T>(entryPath: string, action: () => T): T {
  const lockPath = `${entryPath}.lock`;
  let lockCreated = false;
  try {
    writeJsonFileExclusively(lockPath, {
      version: 1,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    });
    lockCreated = true;
    return action();
  } catch (error) {
    if (!lockCreated && (error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      throw new Error(`Concurrent E2E artifact registry transition is already in progress: ${entryPath}`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    if (lockCreated) {
      fs.rmSync(lockPath, { force: true });
    }
  }
}

function listRunDirectoryIds(registryRoot: string): string[] {
  if (!fs.existsSync(registryRoot)) {
    return [];
  }

  const runIds: string[] = [];
  for (const entry of fs.readdirSync(registryRoot, { withFileTypes: true })) {
    if (entry.name === CURRENT_RUN_FILE_NAME) {
      if (!entry.isFile()) {
        throw new Error(`E2E artifact current-run pointer is not a file: ${entry.name}`);
      }
      continue;
    }
    if (entry.name.startsWith('.tmp-')) {
      throw new Error(`Unfinished atomic E2E artifact registry file found: ${entry.name}`);
    }
    if (!entry.isDirectory()) {
      throw new Error(`Unexpected E2E artifact registry entry: ${entry.name}`);
    }
    assertValidRunId(entry.name);
    runIds.push(entry.name);
  }
  return runIds.sort();
}

function resolveRunId(registryRoot: string, runId?: string): string {
  if (runId) {
    assertValidRunId(runId);
    return runId;
  }
  const currentRun = getCurrentArtifactRun({ rootDirectory: registryRoot });
  if (!currentRun) {
    throw new Error('E2E artifact run registry is not initialized');
  }
  return currentRun.runId;
}

function ensureRunDirectoryContainsOnlyRegistryFiles(
  registryRoot: string,
  runId: string,
): void {
  const runDirectory = runDirectoryPath(registryRoot, runId);
  const allowed = new Set([RUN_DESCRIPTOR_FILE_NAME, ARTIFACT_DIRECTORY_NAME]);
  for (const entry of fs.readdirSync(runDirectory, { withFileTypes: true })) {
    if (!allowed.has(entry.name)) {
      throw new Error(`Unexpected entry in E2E artifact run ${runId}: ${entry.name}`);
    }
    if (entry.name === RUN_DESCRIPTOR_FILE_NAME && !entry.isFile()) {
      throw new Error(`E2E artifact run descriptor is not a file for ${runId}`);
    }
    if (entry.name === ARTIFACT_DIRECTORY_NAME && !entry.isDirectory()) {
      throw new Error(`E2E artifact directory is not a directory for ${runId}`);
    }
  }
}

function ensureArtifactRootContainsOnlyKindDirectories(
  registryRoot: string,
  runId: string,
): void {
  const artifactRoot = path.join(runDirectoryPath(registryRoot, runId), ARTIFACT_DIRECTORY_NAME);
  if (!fs.existsSync(artifactRoot)) {
    return;
  }

  for (const entry of fs.readdirSync(artifactRoot, { withFileTypes: true })) {
    if (!ARTIFACT_KINDS.includes(entry.name as TestArtifactKind) || !entry.isDirectory()) {
      throw new Error(
        `Unexpected artifact kind entry in E2E run ${runId}: ${entry.name}`,
      );
    }
  }
}

/**
 * Starts one exclusive artifact run or returns the caller's already-active run.
 * A live foreign PID and every stale/corrupt registry state fail closed.
 */
export function initializeArtifactRunRegistry(
  options: InitializeArtifactRunRegistryOptions = {},
): CurrentArtifactRun {
  const registryRoot = resolveRegistryRoot(options.rootDirectory);
  const callerPid = options.pid ?? process.pid;
  if (!Number.isSafeInteger(callerPid) || callerPid <= 0) {
    throw new Error(`Invalid E2E artifact registry PID: ${callerPid}`);
  }
  fs.mkdirSync(registryRoot, { recursive: true, mode: 0o700 });

  const existingRun = getCurrentArtifactRun({ rootDirectory: registryRoot });
  if (existingRun) {
    if (existingRun.isPidActive && existingRun.pid === callerPid
      && existingRun.processNonce === PROCESS_NONCE) {
      if (options.runId && options.runId !== existingRun.runId) {
        throw new Error(
          `E2E artifact run ${existingRun.runId} is already active in this PID; `
          + `refusing requested replacement ${options.runId}`,
        );
      }
      return existingRun;
    }
    if (existingRun.isPidActive) {
      throw new Error(
        `E2E artifact run ${existingRun.runId} belongs to another active process identity `
        + `(PID ${existingRun.pid}); `
        + 'parallel Playwright runs are not allowed',
      );
    }
    throw new Error(
      `Stale E2E artifact run ${existingRun.runId} from dead PID ${existingRun.pid} `
      + 'must be inspected and finished explicitly before starting another run',
    );
  }

  const unfinishedRunIds = listRunDirectoryIds(registryRoot);
  if (unfinishedRunIds.length > 0) {
    throw new Error(
      `Unfinished E2E artifact run directories require explicit inspection: `
      + unfinishedRunIds.join(', '),
    );
  }

  const run: StoredArtifactRun = {
    version: 1,
    runId: options.runId ?? `run-${crypto.randomUUID()}`,
    pid: callerPid,
    processNonce: PROCESS_NONCE,
    startedAt: (options.now ?? new Date()).toISOString(),
  };
  assertValidRunId(run.runId);

  const runDirectory = runDirectoryPath(registryRoot, run.runId);
  fs.mkdirSync(runDirectory, { recursive: false, mode: 0o700 });
  try {
    writeJsonFileExclusively(runDescriptorFilePath(registryRoot, run.runId), run);
    publishJsonFileAtomically(currentRunFilePath(registryRoot), run);
  } catch (error) {
    fs.rmSync(runDirectory, { recursive: true, force: true });
    throw new Error('Failed to initialize exclusive E2E artifact run registry', {
      cause: error,
    });
  }

  return { ...run, isPidActive: isProcessActive(run.pid) };
}

/** Reads and validates the current-run pointer without modifying stale state. */
export function getCurrentArtifactRun(
  options: Pick<InitializeArtifactRunRegistryOptions, 'rootDirectory'> = {},
): CurrentArtifactRun | null {
  const registryRoot = resolveRegistryRoot(options.rootDirectory);
  const pointerPath = currentRunFilePath(registryRoot);
  if (!fs.existsSync(pointerPath)) {
    return null;
  }

  const pointer = validateStoredRun(
    readJsonFileFailClosed(pointerPath, 'E2E artifact current-run pointer'),
    `E2E artifact current-run pointer at ${pointerPath}`,
  );
  const descriptor = readRunDescriptor(registryRoot, pointer.runId);
  assertCurrentPointerMatchesDescriptor(pointer, descriptor);
  return { ...pointer, isPidActive: isProcessActive(pointer.pid) };
}

/** Returns this Node process identity without exposing its nonce to logs. */
export function getArtifactRegistryProcessIdentity(): Pick<StoredArtifactRun, 'pid' | 'processNonce'> {
  return { pid: process.pid, processNonce: PROCESS_NONCE };
}

/** Registers an exact artifact name in the current run before any API/UI mutation. */
export function registerTestArtifact(kind: TestArtifactKind, name: string): void {
  assertValidArtifactKind(kind);
  assertValidArtifactName(name);
  const registryRoot = resolveRegistryRoot();
  const currentRun = getCurrentArtifactRun({ rootDirectory: registryRoot });
  if (!currentRun) {
    throw new Error('Cannot register E2E artifact before artifact run initialization');
  }

  const entry: StoredTestArtifact = {
    version: 1,
    runId: currentRun.runId,
    kind,
    name,
    status: 'planned',
    serverId: null,
    registeredAt: new Date().toISOString(),
    registeredByPid: process.pid,
    confirmedAt: null,
  };
  const directory = artifactDirectoryPath(registryRoot, currentRun.runId, kind);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const entryPath = artifactEntryFilePath(registryRoot, currentRun.runId, kind, name);

  try {
    publishJsonFileAtomically(entryPath, entry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
      throw new Error(`Failed to register E2E ${kind} ${JSON.stringify(name)}`, {
        cause: error,
      });
    }
    const existing = validateStoredArtifact(
      readJsonFileFailClosed(entryPath, `registered E2E ${kind}`),
      currentRun.runId,
      kind,
      `registered E2E ${kind} at ${entryPath}`,
    );
    if (existing.name !== name) {
      throw new Error(`E2E artifact registry hash collision for ${JSON.stringify(name)}`);
    }
  }
}

/** Atomically confirms that the server created a previously planned artifact. */
export function confirmTestArtifact(
  kind: TestArtifactKind,
  name: string,
  serverId: number,
): void {
  assertValidArtifactKind(kind);
  assertValidArtifactName(name);
  if (!Number.isSafeInteger(serverId) || serverId <= 0) {
    throw new Error(`Invalid E2E ${kind} serverId: ${JSON.stringify(serverId)}`);
  }

  const registryRoot = resolveRegistryRoot();
  const currentRun = getCurrentArtifactRun({ rootDirectory: registryRoot });
  if (!currentRun) {
    throw new Error('Cannot confirm E2E artifact before artifact run initialization');
  }
  const entryPath = artifactEntryFilePath(registryRoot, currentRun.runId, kind, name);
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Cannot confirm unregistered E2E ${kind} ${JSON.stringify(name)}`);
  }

  withExclusiveArtifactEntryLock(entryPath, () => {
    const existing = validateStoredArtifact(
      readJsonFileFailClosed(entryPath, `registered E2E ${kind}`),
      currentRun.runId,
      kind,
      `registered E2E ${kind} at ${entryPath}`,
    );
    if (existing.name !== name) {
      throw new Error(`Refusing to confirm mismatched E2E ${kind} ${JSON.stringify(name)}`);
    }

    if (existing.status === 'confirmed') {
      if (existing.serverId !== null && existing.serverId !== serverId) {
        throw new Error(
          `E2E ${kind} ${JSON.stringify(name)} is already confirmed with serverId `
          + `${existing.serverId}; refusing conflicting ${serverId}`,
        );
      }
      if (existing.serverId === serverId) {
        return;
      }
    }

    const confirmed: StoredTestArtifact = {
      ...existing,
      status: 'confirmed',
      serverId,
      confirmedAt: existing.confirmedAt ?? new Date().toISOString(),
    };
    replaceJsonFileAtomically(entryPath, confirmed);
  });
}

/** Returns exact confirmed ownership so planned/name-only records cannot authorize cleanup. */
export function requireConfirmedTestArtifact(
  kind: TestArtifactKind, name: string, expectedServerId?: number,
): RegisteredTestArtifact {
  assertValidArtifactKind(kind);
  assertValidArtifactName(name);
  if (expectedServerId !== undefined && (!Number.isSafeInteger(expectedServerId) || expectedServerId <= 0)) {
    throw new Error(`Invalid expected E2E ${kind} serverId: ${JSON.stringify(expectedServerId)}`);
  }

  const registryRoot = resolveRegistryRoot();
  const currentRun = getCurrentArtifactRun({ rootDirectory: registryRoot });
  if (!currentRun) throw new Error('Cannot authorize E2E artifact cleanup without an active artifact run');

  const entryPath = artifactEntryFilePath(registryRoot, currentRun.runId, kind, name);
  if (!fs.existsSync(entryPath)) throw new Error(`Cannot clean unregistered E2E ${kind} ${JSON.stringify(name)}`);
  const artifact = validateStoredArtifact(
    readJsonFileFailClosed(entryPath, `registered E2E ${kind}`),
    currentRun.runId,
    kind,
    `registered E2E ${kind} at ${entryPath}`,
  );
  if (artifact.name !== name) throw new Error(`Refusing cleanup for mismatched E2E ${kind} ${JSON.stringify(name)}`);
  if (artifact.status !== 'confirmed' || artifact.serverId === null) {
    throw new Error(
      `Cannot clean planned E2E ${kind} ${JSON.stringify(name)} without confirmed server identity`,
    );
  }
  if (expectedServerId !== undefined && artifact.serverId !== expectedServerId) {
    throw new Error(
      `E2E ${kind} ${JSON.stringify(name)} server identity mismatch: `
      + `registered=${artifact.serverId}, current=${expectedServerId}`,
    );
  }
  return artifact;
}

/** Removes one exact registry entry only after external cleanup has been confirmed. */
export function unregisterTestArtifact(
  kind: TestArtifactKind,
  name: string,
  runId?: string,
): void {
  assertValidArtifactKind(kind);
  assertValidArtifactName(name);
  const registryRoot = resolveRegistryRoot();
  const resolvedRunId = resolveRunId(registryRoot, runId);
  readRunDescriptor(registryRoot, resolvedRunId);
  const entryPath = artifactEntryFilePath(registryRoot, resolvedRunId, kind, name);
  if (!fs.existsSync(entryPath)) {
    return;
  }

  const existing = validateStoredArtifact(
    readJsonFileFailClosed(entryPath, `registered E2E ${kind}`),
    resolvedRunId,
    kind,
    `registered E2E ${kind} at ${entryPath}`,
  );
  if (existing.name !== name) {
    throw new Error(`Refusing to unregister mismatched E2E ${kind} ${JSON.stringify(name)}`);
  }
  fs.unlinkSync(entryPath);
}

/** Lists exact owned artifacts for the current or an explicitly named stale run. */
export function listRegisteredTestArtifacts(runId?: string): RegisteredTestArtifact[] {
  const registryRoot = resolveRegistryRoot();
  const resolvedRunId = resolveRunId(registryRoot, runId);
  readRunDescriptor(registryRoot, resolvedRunId);
  ensureRunDirectoryContainsOnlyRegistryFiles(registryRoot, resolvedRunId);
  ensureArtifactRootContainsOnlyKindDirectories(registryRoot, resolvedRunId);

  const artifacts: StoredTestArtifact[] = [];
  for (const kind of ARTIFACT_KINDS) {
    const directory = artifactDirectoryPath(registryRoot, resolvedRunId, kind);
    if (!fs.existsSync(directory)) {
      continue;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        throw new Error(
          `Unexpected entry in E2E ${kind} registry for ${resolvedRunId}: ${entry.name}`,
        );
      }
      const entryPath = path.join(directory, entry.name);
      const artifact = validateStoredArtifact(
        readJsonFileFailClosed(entryPath, `registered E2E ${kind}`),
        resolvedRunId,
        kind,
        `registered E2E ${kind} at ${entryPath}`,
      );
      const expectedPath = artifactEntryFilePath(
        registryRoot,
        resolvedRunId,
        kind,
        artifact.name,
      );
      if (entryPath !== expectedPath) {
        throw new Error(`E2E artifact registry filename mismatch at ${entryPath}`);
      }
      artifacts.push(artifact);
    }
  }

  return artifacts.sort((left, right) => {
    const timeDifference = left.registeredAt.localeCompare(right.registeredAt);
    if (timeDifference !== 0) {
      return timeDifference;
    }
    return `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`);
  });
}

/**
 * Removes an empty run and its matching current pointer.
 * Registered or corrupt artifacts must be handled explicitly before this call.
 */
export function finishArtifactRunRegistry(runId: string): void {
  assertValidRunId(runId);
  const registryRoot = resolveRegistryRoot();
  const registeredArtifacts = listRegisteredTestArtifacts(runId);
  if (registeredArtifacts.length > 0) {
    throw new Error(
      `Cannot finish E2E artifact run ${runId}; ${registeredArtifacts.length} artifact(s) remain`,
    );
  }

  const pointerPath = currentRunFilePath(registryRoot);
  if (fs.existsSync(pointerPath)) {
    const pointer = validateStoredRun(
      readJsonFileFailClosed(pointerPath, 'E2E artifact current-run pointer'),
      `E2E artifact current-run pointer at ${pointerPath}`,
    );
    if (pointer.runId === runId) {
      const descriptor = readRunDescriptor(registryRoot, runId);
      assertCurrentPointerMatchesDescriptor(pointer, descriptor);
      fs.unlinkSync(pointerPath);
    }
  }

  fs.rmSync(runDirectoryPath(registryRoot, runId), { recursive: true, force: false });
}
