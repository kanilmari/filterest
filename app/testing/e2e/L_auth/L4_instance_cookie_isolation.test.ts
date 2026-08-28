/**
 * L4_instance_cookie_isolation.test.ts
 *
 * Starts two real Easelect session runtimes on one browser hostname and separate
 * ports. Proves that login, logout, reset, and persisted browser state stay scoped
 * to the current instance even when both runtimes receive the same raw secrets.
 */

import { test, expect, chromium, type APIRequestContext } from '@playwright/test';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

type InstanceState = {
  authenticated: boolean;
  cookie_names: {
    Session: string;
    DeviceID: string;
    Fingerprint: string;
  };
  device_cookie: boolean;
  fingerprint_cookie: boolean;
};

let tempDirectory = '';
let binaryPath = '';
const servers: ChildProcessWithoutNullStreams[] = [];

async function startInstance(instanceName: string, databaseName: string): Promise<string> {
  const process = spawn(binaryPath, [], {
    env: {
      ...globalThis.process.env,
      INSTANCE_NAME: instanceName,
      DB_HOST: '127.0.0.1',
      DB_PORT: '5433',
      DB_NAME: databaseName,
      SESSION_COOKIE_MODE: 'isolated',
      SESSION_COOKIE_NAME: '',
      SESSION_KEY: 'test-only-shared-raw-signing-key',
      SESSION_SECRET_KEY: 'test-only-shared-raw-encryption-key',
      ALLOW_INSECURE_DEV_PROXY: 'true',
      ENVIRONMENT_TYPE: 'dev',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  servers.push(process);

  return await new Promise<string>((resolve, reject) => {
    const stderr: string[] = [];
    process.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    process.once('exit', (code) => reject(new Error(
      `${instanceName} exited before readiness (code ${code}): ${stderr.join('')}`,
    )));
    const lines = createInterface({ input: process.stdout });
    lines.on('line', (line) => {
      if (line.startsWith('READY ')) {
        resolve(line.slice('READY '.length).trim());
      }
    });
  });
}

async function readState(request: APIRequestContext, baseURL: string): Promise<InstanceState> {
  const response = await request.get(`${baseURL}/state`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as InstanceState;
}

test.describe('L4 — parallel instance authentication-cookie isolation', () => {
  test.beforeAll(async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'easelect-cookie-isolation-'));
    binaryPath = join(tempDirectory, 'cookie-instance-harness');
    const build = spawnSync(
      'go',
      ['build', '-o', binaryPath, './testing/e2e/helpers/cookie_instance_harness'],
      {
        cwd: process.cwd(),
        env: { ...process.env, GOCACHE: join(tempDirectory, 'go-cache') },
        encoding: 'utf8',
      },
    );
    if (build.status !== 0) {
      throw new Error(`cookie harness build failed:\n${build.stdout}\n${build.stderr}`);
    }
  });

  test.afterAll(async () => {
    for (const server of servers) {
      server.kill('SIGTERM');
    }
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  test('keeps login, logout, reset, and browser restart inside one instance', async () => {
    const [instanceA, instanceB] = await Promise.all([
      startInstance('serlog-local', 'serlog'),
      startInstance('demo-local', 'demo'),
    ]);

    let browser = await chromium.launch();
    let context = await browser.newContext();

    await expect.poll(async () => (await context.request.get(`${instanceA}/login`)).status()).toBe(204);
    expect((await readState(context.request, instanceB)).authenticated).toBe(false);
    await expect.poll(async () => (await context.request.get(`${instanceB}/login`)).status()).toBe(204);

    const stateA = await readState(context.request, instanceA);
    const stateB = await readState(context.request, instanceB);
    expect(stateA.authenticated).toBe(true);
    expect(stateB.authenticated).toBe(true);
    expect(stateA.device_cookie && stateA.fingerprint_cookie).toBe(true);
    expect(stateB.device_cookie && stateB.fingerprint_cookie).toBe(true);
    expect(Object.values(stateA.cookie_names)).not.toEqual(Object.values(stateB.cookie_names));

    const persistedState = await context.storageState();
    await browser.close();

    browser = await chromium.launch();
    context = await browser.newContext({ storageState: persistedState });
    expect((await readState(context.request, instanceA)).authenticated).toBe(true);
    expect((await readState(context.request, instanceB)).authenticated).toBe(true);

    expect((await context.request.post(`${instanceA}/logout`)).status()).toBe(204);
    expect((await readState(context.request, instanceA)).authenticated).toBe(false);
    expect((await readState(context.request, instanceB)).authenticated).toBe(true);

    expect((await context.request.get(`${instanceA}/login`)).status()).toBe(204);
    expect((await context.request.post(`${instanceA}/api/reset-session`, {
      headers: { Origin: instanceA },
    })).status()).toBe(200);
    expect((await readState(context.request, instanceA)).authenticated).toBe(false);
    expect((await readState(context.request, instanceB)).authenticated).toBe(true);

    const remainingCookieNames = (await context.cookies()).map((cookie) => cookie.name);
    expect(remainingCookieNames).not.toContain(stateA.cookie_names.Session);
    expect(remainingCookieNames).not.toContain(stateA.cookie_names.DeviceID);
    expect(remainingCookieNames).not.toContain(stateA.cookie_names.Fingerprint);
    expect(remainingCookieNames).toContain(stateB.cookie_names.Session);
    expect(remainingCookieNames).toContain(stateB.cookie_names.DeviceID);
    expect(remainingCookieNames).toContain(stateB.cookie_names.Fingerprint);

    await browser.close();
  });
});
