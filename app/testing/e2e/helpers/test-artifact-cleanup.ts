/**
 * test-artifact-cleanup.ts
 *
 * Removes only artifacts that the current E2E run registered and confirmed.
 * Bridges the filesystem ownership registry and authenticated application APIs.
 * Exists so interrupted tests can recover without inferring ownership from names.
 */

import {
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import type { RegisteredTestArtifact } from './test-artifact-run-registry';
import { fetchCsrfTokenForRequest } from './temp-dataset';

type DatasetListResponse = {
  datasets: Array<{
    dataset_name?: string;
  }>;
};

type TreeNode = {
  id?: string;
  name?: string;
  parent_id?: string | null;
  db_id?: number;
  table_uid?: unknown;
};

type DatasetServerIdentity = {
  name: string;
  tableUID: number;
};

type TreeResponse = {
  nodes: TreeNode[];
};

type TranslationsPayload =
  | Record<string, string>
  | {
      translations: Record<string, string>;
    };

type UserProfileResponse = {
  user_id?: unknown;
  username?: unknown;
};

export type ProtectedFolderBaseline = {
  dbId: number;
  name: string;
};

export type ProtectedDatasetBaseline = {
  tableUID: number;
  name: string;
};

export type SyntheticArtifactBaseline = {
  runId: string;
  baseURL: string;
  userId: number;
  username: string;
  datasets: ProtectedDatasetBaseline[];
  folders: ProtectedFolderBaseline[];
  langKeys: string[];
  totalLangKeyCount: number;
  capturedAt: string;
};

export type SyntheticTestCleanupSummary = {
  deletedDatasets: string[];
  deletedFolders: string[];
  deletedLangKeys: string[];
  remainingDatasetNames: string[];
  remainingFolderNames: string[];
  remainingSyntheticLangKeys: string[];
  totalLangKeyCount: number;
};

export type LangKeyInventory = {
  totalLangKeyCount: number;
  allLangKeys: string[];
};

const MAX_FOLDER_DELETE_PASSES = 6;

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

export function normalizeE2EBaseURL(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('E2E baseURL must be an HTTP(S) origin without embedded credentials.');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

function isFolderNode(node: TreeNode): node is TreeNode & {
  id: string;
  name: string;
  db_id: number;
} {
  return (
    typeof node.id === 'string' &&
    node.id.startsWith('f_') &&
    typeof node.name === 'string' &&
    typeof node.db_id === 'number' &&
    Number.isSafeInteger(node.db_id) &&
    node.db_id > 0
  );
}

export function validateSyntheticArtifactBaseline(value: unknown): SyntheticArtifactBaseline {
  if (!value || typeof value !== 'object') {
    throw new Error('E2E artifact baseline must be an object. Cleanup was not started.');
  }

  const candidate = value as Partial<SyntheticArtifactBaseline>;
  const datasetsValid = Array.isArray(candidate.datasets) &&
    candidate.datasets.every((dataset) =>
      dataset &&
      Number.isSafeInteger(dataset.tableUID) &&
      dataset.tableUID > 0 &&
      typeof dataset.name === 'string' &&
      dataset.name.trim() !== '',
    );
  const foldersValid = Array.isArray(candidate.folders) &&
    candidate.folders.every((folder) =>
      folder &&
      Number.isSafeInteger(folder.dbId) &&
      folder.dbId > 0 &&
      typeof folder.name === 'string' &&
      folder.name.trim() !== '',
    );
  const langKeysValid = Array.isArray(candidate.langKeys) &&
    candidate.langKeys.every((key) => typeof key === 'string' && key.trim() !== '');
  const totalValid = Number.isSafeInteger(candidate.totalLangKeyCount) &&
    (candidate.totalLangKeyCount ?? -1) >= 0;
  const capturedAtValid = typeof candidate.capturedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.capturedAt));

  if (
    typeof candidate.runId !== 'string' || candidate.runId.trim() === '' ||
    typeof candidate.baseURL !== 'string' || candidate.baseURL.trim() === '' ||
    !Number.isSafeInteger(candidate.userId) || (candidate.userId ?? 0) <= 1 ||
    typeof candidate.username !== 'string' || candidate.username.trim() === '' ||
    !datasetsValid ||
    !foldersValid ||
    !langKeysValid ||
    !totalValid ||
    !capturedAtValid
  ) {
    throw new Error(
      'E2E artifact baseline is incomplete. Cleanup requires run identity and complete ' +
      'dataset, folder, and language-key protection sets.',
    );
  }

  const langKeys = uniqueSorted(candidate.langKeys!);
  if (candidate.totalLangKeyCount !== langKeys.length) {
    throw new Error('E2E artifact baseline language-key count does not match its key list.');
  }

  const foldersById = new Map<number, string>();
  for (const folder of candidate.folders!) {
    const existingName = foldersById.get(folder.dbId);
    if (existingName && existingName !== folder.name) {
      throw new Error(`E2E artifact baseline has conflicting names for folder ${folder.dbId}.`);
    }
    foldersById.set(folder.dbId, folder.name);
  }

  const datasetsById = new Map<number, string>();
  const datasetIdsByName = new Map<string, number>();
  for (const dataset of candidate.datasets!) {
    const existingName = datasetsById.get(dataset.tableUID);
    if (existingName && existingName !== dataset.name) {
      throw new Error(`E2E artifact baseline has conflicting names for dataset ${dataset.tableUID}.`);
    }
    const existingTableUID = datasetIdsByName.get(dataset.name);
    if (existingTableUID && existingTableUID !== dataset.tableUID) {
      throw new Error(`E2E artifact baseline has conflicting table_uid values for dataset "${dataset.name}".`);
    }
    datasetsById.set(dataset.tableUID, dataset.name);
    datasetIdsByName.set(dataset.name, dataset.tableUID);
  }

  return {
    runId: candidate.runId!,
    baseURL: normalizeE2EBaseURL(candidate.baseURL!),
    userId: candidate.userId!,
    username: candidate.username!,
    datasets: Array.from(datasetsById, ([tableUID, name]) => ({ tableUID, name }))
      .sort((left, right) => left.tableUID - right.tableUID),
    folders: Array.from(foldersById, ([dbId, name]) => ({ dbId, name }))
      .sort((left, right) => left.dbId - right.dbId),
    langKeys,
    totalLangKeyCount: candidate.totalLangKeyCount!,
    capturedAt: candidate.capturedAt!,
  };
}

export function validateConfirmedTestArtifacts(
  artifacts: RegisteredTestArtifact[],
  baseline: SyntheticArtifactBaseline,
): RegisteredTestArtifact[] {
  if (!Array.isArray(artifacts)) {
    throw new Error('Registered E2E artifact inventory must be an array.');
  }

  const protectedDatasetNames = new Set(baseline.datasets.map((dataset) => dataset.name));
  const protectedDatasetIds = new Set(baseline.datasets.map((dataset) => dataset.tableUID));
  const protectedFolderNames = new Set(baseline.folders.map((folder) => folder.name));
  const protectedFolderIds = new Set(baseline.folders.map((folder) => folder.dbId));
  const exactKeys = new Set<string>();
  const stableKeys = new Set<string>();

  for (const artifact of artifacts) {
    if (
      !artifact ||
      artifact.runId !== baseline.runId ||
      (artifact.kind !== 'dataset' && artifact.kind !== 'folder') ||
      typeof artifact.name !== 'string' || artifact.name.trim() === '' ||
      artifact.status !== 'confirmed'
    ) {
      throw new Error('Cleanup requires every registered E2E artifact to be confirmed.');
    }
    if (!artifact.serverId || !Number.isSafeInteger(artifact.serverId) || artifact.serverId <= 0) {
      throw new Error(`Confirmed E2E ${artifact.kind} "${artifact.name}" is missing its server id.`);
    }
    if (artifact.kind === 'dataset' && protectedDatasetNames.has(artifact.name)) {
      throw new Error(`Refusing to clean baseline dataset "${artifact.name}".`);
    }
    if (artifact.kind === 'dataset' && protectedDatasetIds.has(artifact.serverId)) {
      throw new Error(
        `Refusing to clean dataset "${artifact.name}" with baseline table_uid ${artifact.serverId}.`,
      );
    }
    if (artifact.kind === 'folder' && protectedFolderNames.has(artifact.name)) {
      throw new Error(`Refusing to clean baseline folder "${artifact.name}".`);
    }
    if (artifact.kind === 'folder' && protectedFolderIds.has(artifact.serverId)) {
      throw new Error(
        `Refusing to clean folder "${artifact.name}" with baseline folder id ${artifact.serverId}.`,
      );
    }

    const exactKey = `${artifact.kind}\0${artifact.name}`;
    if (exactKeys.has(exactKey)) {
      throw new Error(`Duplicate registered E2E artifact "${artifact.kind}:${artifact.name}".`);
    }
    exactKeys.add(exactKey);

    const stableKey = `${artifact.kind}\0${artifact.serverId}`;
    if (stableKeys.has(stableKey)) {
      throw new Error(
        `Duplicate registered E2E artifact server identity "${artifact.kind}:${artifact.serverId}".`,
      );
    }
    stableKeys.add(stableKey);
  }

  return [...artifacts];
}

function normalizeTranslationsPayload(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Malformed translations inventory response.');
  }
  if ('translations' in payload) {
    const translations = (payload as { translations?: unknown }).translations;
    if (!translations || typeof translations !== 'object' || Array.isArray(translations)) {
      throw new Error('Malformed translations map in inventory response.');
    }
    return translations as Record<string, string>;
  }
  return payload as Record<string, string>;
}

async function readJsonResponse<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url);
  const body = await response.text();
  if (!response.ok()) {
    throw new Error(`Failed GET ${url}: ${response.status()} ${body}`);
  }
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON from GET ${url}`, { cause: error });
  }
}

async function postJsonWithCsrf(
  request: APIRequestContext,
  url: string,
  payload: Record<string, unknown>,
  csrfToken: string,
): Promise<{ status: number; ok: boolean; body: string }> {
  const response = await request.post(url, {
    data: payload,
    headers: { 'X-CSRF-Token': csrfToken },
  });
  return { status: response.status(), ok: response.ok(), body: await response.text() };
}

export async function readLangKeyInventory(request: APIRequestContext): Promise<LangKeyInventory> {
  const parsed = await readJsonResponse<TranslationsPayload>(request, '/api/translations?lang=en');
  const keys = uniqueSorted(Object.keys(normalizeTranslationsPayload(parsed)));
  return { totalLangKeyCount: keys.length, allLangKeys: keys };
}

export async function assertAuthenticatedCleanupIdentity(
  request: APIRequestContext,
  baseline: Pick<SyntheticArtifactBaseline, 'userId' | 'username'>,
): Promise<void> {
  const profile = await readJsonResponse<UserProfileResponse>(request, '/api/user-profile');
  if (
    typeof profile?.user_id !== 'number' ||
    !Number.isSafeInteger(profile.user_id) ||
    profile.user_id <= 1 ||
    typeof profile?.username !== 'string' ||
    profile.username.trim() === ''
  ) {
    throw new Error('Malformed authenticated user profile. No E2E cleanup request was sent.');
  }
  if (profile.user_id !== baseline.userId || profile.username !== baseline.username) {
    throw new Error(
      `Authenticated cleanup identity mismatch: expected ${baseline.username} ` +
      `(${baseline.userId}), got ${profile.username} (${profile.user_id}). ` +
      'No E2E cleanup request was sent.',
    );
  }
}

async function listAllDatasetNames(request: APIRequestContext): Promise<string[]> {
  const parsed = await readJsonResponse<DatasetListResponse>(request, '/api/datasets');
  if (!parsed || !Array.isArray(parsed.datasets)) {
    throw new Error('Malformed /api/datasets inventory: datasets must be an array.');
  }
  return uniqueSorted(
    parsed.datasets
      .map((dataset) => dataset?.dataset_name)
      .filter((name): name is string => typeof name === 'string' && name.trim() !== ''),
  );
}

async function listAllDatasetServerIdentities(
  request: APIRequestContext,
): Promise<DatasetServerIdentity[]> {
  const parsed = await readJsonResponse<TreeResponse>(request, '/api/tree_data');
  if (!parsed || !Array.isArray(parsed.nodes)) {
    throw new Error('Malformed /api/tree_data dataset inventory: nodes must be an array.');
  }

  const identitiesByName = new Map<string, number>();
  for (const node of parsed.nodes) {
    if (typeof node?.name !== 'string' || node.name.trim() === '' || node.table_uid == null) {
      continue;
    }
    const tableUID = typeof node.table_uid === 'number'
      ? node.table_uid
      : typeof node.table_uid === 'string' && /^\d+$/.test(node.table_uid)
        ? Number(node.table_uid)
        : Number.NaN;
    if (!Number.isSafeInteger(tableUID) || tableUID <= 0) {
      throw new Error(`Malformed table_uid for dataset "${node.name}" in /api/tree_data.`);
    }
    const existingTableUID = identitiesByName.get(node.name);
    if (existingTableUID !== undefined && existingTableUID !== tableUID) {
      throw new Error(
        `Conflicting table_uid values for dataset "${node.name}" in /api/tree_data.`,
      );
    }
    identitiesByName.set(node.name, tableUID);
  }

  return Array.from(identitiesByName, ([name, tableUID]) => ({ name, tableUID }));
}

async function listAllFolderNodes(
  request: APIRequestContext,
): Promise<Array<TreeNode & { id: string; name: string; db_id: number }>> {
  const parsed = await readJsonResponse<TreeResponse>(request, '/api/tree_data');
  if (!parsed || !Array.isArray(parsed.nodes)) {
    throw new Error('Malformed /api/tree_data inventory: nodes must be an array.');
  }
  return parsed.nodes.filter(isFolderNode);
}

function sortFoldersByDepthDescending(
  nodes: Array<TreeNode & { id: string; name: string; db_id: number }>,
): Array<TreeNode & { id: string; name: string; db_id: number }> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depthCache = new Map<string, number>();
  const getDepth = (node: TreeNode & { id: string }): number => {
    const cached = depthCache.get(node.id);
    if (cached !== undefined) return cached;
    const parent = typeof node.parent_id === 'string' ? byId.get(node.parent_id) : null;
    const depth = parent ? getDepth(parent) + 1 : 0;
    depthCache.set(node.id, depth);
    return depth;
  };
  return [...nodes].sort((left, right) => getDepth(right) - getDepth(left));
}

function validateRegisteredDatasetIdentity(
  artifact: RegisteredTestArtifact,
  liveDatasetNames: string[],
  liveDatasetIdentities: DatasetServerIdentity[],
): boolean {
  const liveNames = new Set(liveDatasetNames);
  const identityByName = new Map(
    liveDatasetIdentities.map((identity) => [identity.name, identity.tableUID]),
  );
  const nameExists = liveNames.has(artifact.name);
  const currentTableUID = identityByName.get(artifact.name);

  if (!nameExists && currentTableUID === undefined) {
    return false;
  }
  if (!nameExists || currentTableUID === undefined) {
    throw new Error(
      `Refusing to drop registered E2E dataset "${artifact.name}": `
      + 'the live inventories disagree about its stable table_uid identity.',
    );
  }
  if (currentTableUID !== artifact.serverId) {
    throw new Error(
      `Refusing to drop registered E2E dataset "${artifact.name}": `
      + `registered table_uid=${artifact.serverId}, current table_uid=${currentTableUID}.`,
    );
  }
  return true;
}

async function dropRegisteredDatasets(
  request: APIRequestContext,
  csrfToken: string,
  artifacts: RegisteredTestArtifact[],
): Promise<string[]> {
  const resolved: string[] = [];
  const datasets = artifacts.filter((artifact) => artifact.kind === 'dataset').reverse();
  const [liveDatasetNames, liveDatasetIdentities] = await Promise.all([
    listAllDatasetNames(request),
    listAllDatasetServerIdentities(request),
  ]);
  const deletionCandidates: RegisteredTestArtifact[] = [];

  // Validate every current server identity before the first destructive request.
  // This prevents partial cleanup when any registered name was replaced or is ambiguous.
  for (const artifact of datasets) {
    if (!validateRegisteredDatasetIdentity(artifact, liveDatasetNames, liveDatasetIdentities)) {
      resolved.push(artifact.name);
      continue;
    }
    deletionCandidates.push(artifact);
  }

  for (const artifact of deletionCandidates) {
    // The API currently deletes by name. Re-read and validate the exact stable
    // identity immediately before that name-only request to close the setup-to-delete race.
    const [latestDatasetNames, latestDatasetIdentities] = await Promise.all([
      listAllDatasetNames(request),
      listAllDatasetServerIdentities(request),
    ]);
    if (!validateRegisteredDatasetIdentity(
      artifact,
      latestDatasetNames,
      latestDatasetIdentities,
    )) {
      resolved.push(artifact.name);
      continue;
    }
    const response = await postJsonWithCsrf(
      request,
      '/api/drop-dataset',
      { dataset_name: artifact.name },
      csrfToken,
    );
    if (response.ok || response.body.includes('does not exist')) {
      resolved.push(artifact.name);
      continue;
    }
    throw new Error(
      `Failed to drop registered E2E dataset "${artifact.name}": ` +
      `${response.status} ${response.body}`,
    );
  }
  return resolved;
}

async function deleteRegisteredFolders(
  request: APIRequestContext,
  csrfToken: string,
  artifacts: RegisteredTestArtifact[],
): Promise<string[]> {
  const folders = artifacts.filter((artifact) => artifact.kind === 'folder');
  const resolved = new Set<string>();

  for (let pass = 0; pass < MAX_FOLDER_DELETE_PASSES; pass += 1) {
    const liveNodes = await listAllFolderNodes(request);
    const byServerId = new Map(liveNodes.map((node) => [node.db_id, node]));
    const candidates = sortFoldersByDepthDescending(
      folders
        .map((artifact) => byServerId.get(artifact.serverId!))
        .filter((node): node is TreeNode & { id: string; name: string; db_id: number } => Boolean(node)),
    );

    for (const artifact of folders) {
      const liveNode = byServerId.get(artifact.serverId!);
      if (!liveNode) {
        resolved.add(artifact.name);
      } else if (liveNode.name !== artifact.name) {
        throw new Error(
          `Refusing to delete folder id ${artifact.serverId}: registry name ` +
          `"${artifact.name}" does not match live name "${liveNode.name}".`,
        );
      }
    }

    if (candidates.length === 0) break;
    let progress = false;
    for (const folder of candidates) {
      const response = await postJsonWithCsrf(
        request,
        '/api/delete-folder',
        { folder_id: folder.db_id },
        csrfToken,
      );
      if (response.ok || response.body.includes('not found')) {
        resolved.add(folder.name);
        progress = true;
        continue;
      }
      if (response.status === 409) continue;
      throw new Error(
        `Failed to delete registered E2E folder "${folder.name}" (${folder.db_id}): ` +
        `${response.status} ${response.body}`,
      );
    }
    if (!progress) break;
  }

  return Array.from(resolved).sort();
}

export async function readSyntheticArtifactBaseline(
  request: APIRequestContext,
  identity: Pick<SyntheticArtifactBaseline, 'runId' | 'baseURL' | 'userId' | 'username'>,
): Promise<SyntheticArtifactBaseline> {
  const [, datasetNames, datasetIdentities, folderNodes, langKeyInventory] = await Promise.all([
    assertAuthenticatedCleanupIdentity(request, identity),
    listAllDatasetNames(request),
    listAllDatasetServerIdentities(request),
    listAllFolderNodes(request),
    readLangKeyInventory(request),
  ]);
  const datasetIdentityNames = new Set(datasetIdentities.map((dataset) => dataset.name));
  const namesMissingStableIdentity = datasetNames.filter((name) => !datasetIdentityNames.has(name));
  if (namesMissingStableIdentity.length > 0) {
    throw new Error(
      'Cannot capture a complete E2E artifact baseline because these datasets lack table_uid: ' +
      namesMissingStableIdentity.join(', '),
    );
  }
  return validateSyntheticArtifactBaseline({
    ...identity,
    datasets: datasetIdentities,
    folders: folderNodes.map((folder) => ({ dbId: folder.db_id, name: folder.name })),
    langKeys: langKeyInventory.allLangKeys,
    totalLangKeyCount: langKeyInventory.totalLangKeyCount,
    capturedAt: new Date().toISOString(),
  });
}

export async function cleanupSyntheticTestArtifacts(
  request: APIRequestContext,
  rawBaseline: SyntheticArtifactBaseline,
  rawArtifacts: RegisteredTestArtifact[],
): Promise<SyntheticTestCleanupSummary> {
  const baseline = validateSyntheticArtifactBaseline(rawBaseline);
  const artifacts = validateConfirmedTestArtifacts(rawArtifacts, baseline);
  const registeredNames = new Set(artifacts.map((artifact) => artifact.name));

  // Verify the identity on the same request context that will obtain the CSRF
  // token and issue cleanup POSTs. A swapped or stale storage state fails
  // before the first mutating request.
  await assertAuthenticatedCleanupIdentity(request, baseline);

  if (artifacts.length === 0) {
    const langKeyInventory = await readLangKeyInventory(request);
    return {
      deletedDatasets: [], deletedFolders: [], deletedLangKeys: [],
      remainingDatasetNames: [], remainingFolderNames: [], remainingSyntheticLangKeys: [],
      totalLangKeyCount: langKeyInventory.totalLangKeyCount,
    };
  }

  const csrfToken = await fetchCsrfTokenForRequest(request);
  const deletedDatasets = await dropRegisteredDatasets(request, csrfToken, artifacts);
  const deletedFolders = await deleteRegisteredFolders(request, csrfToken, artifacts);
  const [remainingDatasets, remainingFolders, langKeyInventory] = await Promise.all([
    listAllDatasetNames(request),
    listAllFolderNodes(request),
    readLangKeyInventory(request),
  ]);
  const registeredFolderIds = new Set(
    artifacts.filter((artifact) => artifact.kind === 'folder').map((artifact) => artifact.serverId),
  );

  return {
    deletedDatasets,
    deletedFolders,
    deletedLangKeys: [],
    remainingDatasetNames: remainingDatasets.filter((name) => registeredNames.has(name)),
    remainingFolderNames: remainingFolders
      .filter((folder) => registeredFolderIds.has(folder.db_id))
      .map((folder) => folder.name)
      .sort(),
    remainingSyntheticLangKeys: langKeyInventory.allLangKeys
      .filter((key) => registeredNames.has(key) && !baseline.langKeys.includes(key)),
    totalLangKeyCount: langKeyInventory.totalLangKeyCount,
  };
}

async function createAuthenticatedRequestContext(baseURL: string, storageStatePath: string) {
  return playwrightRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: storageStatePath,
    extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' },
  });
}

export async function cleanupSyntheticTestArtifactsWithStorageState(
  baseURL: string,
  storageStatePath: string,
  baseline: SyntheticArtifactBaseline,
  artifacts: RegisteredTestArtifact[],
): Promise<SyntheticTestCleanupSummary> {
  const requestContext = await createAuthenticatedRequestContext(baseURL, storageStatePath);
  try {
    return await cleanupSyntheticTestArtifacts(requestContext, baseline, artifacts);
  } finally {
    await requestContext.dispose();
  }
}

export async function readSyntheticArtifactBaselineWithStorageState(
  baseURL: string,
  storageStatePath: string,
  identity: Pick<SyntheticArtifactBaseline, 'runId' | 'baseURL' | 'userId' | 'username'>,
): Promise<SyntheticArtifactBaseline> {
  const requestContext = await createAuthenticatedRequestContext(baseURL, storageStatePath);
  try {
    return await readSyntheticArtifactBaseline(requestContext, identity);
  } finally {
    await requestContext.dispose();
  }
}

export async function readLangKeyInventoryWithStorageState(
  baseURL: string,
  storageStatePath: string,
): Promise<LangKeyInventory> {
  const requestContext = await createAuthenticatedRequestContext(baseURL, storageStatePath);
  try {
    return await readLangKeyInventory(requestContext);
  } finally {
    await requestContext.dispose();
  }
}
