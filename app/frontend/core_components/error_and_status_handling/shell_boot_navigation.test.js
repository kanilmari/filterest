// shell_boot_navigation.test.js
// Checks actual browser document navigation and module evaluation in isolated fixtures.
// Bridges the embedded guard, real auth imports and intercepted GET/POST documents.
// Every request is fulfilled in memory; no server, database or network is used.
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';

const { chromium } = requireNodeDependency('playwright');
const script = readFileSync('backend/core_components/frontend_assets/shell_boot_recovery.js', 'utf8');
const style = readFileSync('backend/core_components/frontend_assets/shell_boot_recovery.css', 'utf8');
const registration = readFileSync('frontend/core_components/auth/register_page_builder.js', 'utf8');
const initialURL = 'https://shell-boot.invalid/failed?lang=fi&tag=a&tag=b&submit=retry#row';
let browser, context, page, documents;

function failureDocument(method, module) {
    return `<!DOCTYPE html><html data-shell-boot-pending data-shell-boot-probe="--filterest-shell-css-applied"
        data-shell-boot-get="${method === 'GET'}" data-shell-boot-dev="false"><head>
        <style>${style}</style><script>${script}</script>
        ${module ? '<style>:root { --filterest-shell-css-applied: 1; }</style><script type="module" src="/entry.js"></script>' : ''}
        </head><body><main data-shell-boot-content><button id="raw">Raw</button></main>
        <div id="shell-boot-notice" hidden><p id="shell-boot-loading" hidden>Loading</p>
        <div id="shell-boot-failed" hidden><button type="button" id="shell-boot-reload">Reload</button></div>
        <p id="shell-boot-unsupported" hidden>Unsupported</p></div>
        ${module ? '' : '<script>window.dispatchEvent(new ErrorEvent("error", { message: "fixture failure" }));</script>'}
        </body></html>`;
}

describe.runIf(process.env.FILTEREST_TEST_ISOLATED_BROWSER === '1')('isolated document recovery', () => {
    beforeAll(async () => {
        browser = await chromium.launch({
            executablePath: process.env.FILTEREST_TEST_CHROMIUM_EXECUTABLE || undefined,
            args: ['--host-resolver-rules=MAP * ~NOTFOUND'],
        });
    });
    afterAll(async () => { await browser?.close(); });
    beforeEach(async () => {
        context = await browser.newContext({ serviceWorkers: 'block' });
        page = await context.newPage(); documents = [];
    });
    afterEach(async () => { await context?.close(); });

    test.each(['GET', 'POST'])('manual retry of a fragment %s response makes a new document GET', async (method) => {
        let manualRetry = false;
        await context.route('**/*', async (route) => {
            const request = route.request();
            if (!request.isNavigationRequest()) { await route.abort(); return; }
            documents.push({ method: request.method(), url: request.url(), body: request.postData() });
            const landing = new URL(request.url()).pathname === '/post-entry';
            await route.fulfill({ contentType: 'text/html', body: manualRetry ? '<!DOCTYPE html><p id="loaded">Loaded</p>' : landing
                ? `<form action="${initialURL}" method="post"><input name="password" value="post-secret"><button>Submit</button></form>`
                : failureDocument(request.method(), false) });
        });
        if (method === 'POST') {
            await page.goto('https://shell-boot.invalid/post-entry');
            await page.locator('form button').click();
        } else { await page.goto(initialURL); }
        await page.locator('#shell-boot-reload').waitFor({ state: 'visible' });
        const before = documents.length;
        expect(before).toBe(2);
        expect(await page.evaluate(() => location.hash)).toBe('#row');
        manualRetry = true;
        await page.locator('#shell-boot-reload').click();
        await page.locator('#loaded').waitFor();
        await expect.poll(() => documents.length).toBe(before + 1);
        const request = documents.at(-1);
        expect(request.method).toBe('GET'); expect(request.body).toBeNull();
        expect(new URL(request.url).search).toBe(new URL(initialURL).search);
        await expect.poll(() => page.evaluate(() => location.hash)).toBe('#row');
        await page.waitForTimeout(1800);
        expect(documents).toHaveLength(before + 1);
    }, 15000);

    test('registration helper followed by a throwing static dependency keeps the app hidden and recovers once', async () => {
        await context.route('**/*', async (route) => {
            const request = route.request();
            const path = new URL(request.url()).pathname;
            if (request.isNavigationRequest()) {
                documents.push(request.method());
                await route.fulfill({ contentType: 'text/html', body: failureDocument(request.method(), true) }); return;
            }
            const modules = {
                '/entry.js': 'import "/frontend/core_components/auth/register_page_builder.js"; import "/throw.js"; window.__filterestShellBoot.evaluated();',
                '/throw.js': 'throw new TypeError("dependency-secret");',
                '/frontend/core_components/auth/register_page_builder.js': registration,
                '/frontend/core_components/lang/translation_handler.js': 'export function translatePage() { return Promise.resolve(); }',
                '/frontend/core_components/state_stores/lang_preference_reader.js': 'export function getPreferredAvailableLanguage() { return "fi"; }',
            };
            if (!modules[path]) { await route.abort(); return; }
            await route.fulfill({ contentType: 'text/javascript', body: modules[path] });
        });
        await page.goto(initialURL);
        await page.locator('#shell-boot-reload').waitFor({ state: 'visible' });
        expect(documents).toEqual(['GET', 'GET']);
        expect(await page.evaluate(() => window.__filterestShellBoot.status())).toMatchObject({ evaluated: false, revealed: false, failure: 'evaluation-error' });
        expect(await page.locator('#raw').isVisible()).toBe(false);
    }, 15000);

    test('real address rewriting reloads the captured URL once under its original budget', async () => {
        await context.route('**/*', async (route) => {
            const request = route.request();
            if (!request.isNavigationRequest()) { await route.abort(); return; }
            documents.push({ url: request.url(), method: request.method(), body: request.postData() });
            await route.fulfill({ contentType: 'text/html', body: failureDocument('GET', false)
                .replace('</body>', `<script>window.fixtureHistoryLength = history.length;
                    history.replaceState({ fixture: 'preserved' }, '', '/');
                    ${documents.length > 1 ? 'var clock = Date.now; Date.now = function () { return clock() + 600001; };' : ''}
                    window.__filterestShellBoot.evaluated();</script></body>`) });
        });
        await page.goto(initialURL);
        await page.locator('#shell-boot-reload').waitFor({ state: 'visible' });
        expect(documents).toHaveLength(2);
        expect(documents.map((request) => request.url)).toEqual([initialURL.split('#')[0], initialURL.split('#')[0]]);
        expect(documents.every((request) => request.method === 'GET' && request.body === null)).toBe(true);
        expect(page.url()).toBe('https://shell-boot.invalid/');
        expect(await page.evaluate(() => history.state)).toEqual({ fixture: 'preserved' });
        expect(await page.evaluate(() => history.length === window.fixtureHistoryLength)).toBe(true);
        expect(await page.evaluate((url) => JSON.parse(sessionStorage.getItem('__filterest_shell_boot_retry_v1:' + url)).unresolved, initialURL)).toBe(true);
        expect(await page.evaluate(() => sessionStorage.getItem('__filterest_shell_boot_retry_v1:' + location.href))).toBeNull();
        await page.waitForTimeout(1800); expect(documents).toHaveLength(2);
    }, 15000);

    test.each(['throw', 'noop'])('automatic History API %s keeps the original budget reserved and offers the button', async (kind) => {
        await context.route('**/*', async (route) => {
            const request = route.request();
            if (!request.isNavigationRequest()) { await route.abort(); return; }
            documents.push(request.url());
            await route.fulfill({ contentType: 'text/html', body: failureDocument('GET', false).replace('</body>', `<script>
                history.replaceState({ fixture: 'preserved' }, '', '/normalized?lang=en#other');
                window.fixtureHistoryLength = history.length;
                var replace = history.replaceState.bind(history);
                history.replaceState = function (state, title, url) {
                    if (url === ${JSON.stringify(initialURL)}) { ${kind === 'throw' ? 'throw new Error("fixture denied");' : 'return;'} }
                    replace(state, title, url);
                };
                </script></body>`) });
        });
        await page.goto(initialURL);
        await page.locator('#shell-boot-reload').waitFor({ state: 'visible' });
        expect(documents).toHaveLength(1);
        expect(page.url()).toBe('https://shell-boot.invalid/normalized?lang=en#other');
        expect(await page.evaluate(() => history.state)).toEqual({ fixture: 'preserved' });
        expect(await page.evaluate(() => history.length === window.fixtureHistoryLength)).toBe(true);
        expect(await page.evaluate((url) => JSON.parse(sessionStorage.getItem('__filterest_shell_boot_retry_v1:' + url)).unresolved, initialURL)).toBe(true);
        await page.waitForTimeout(1800); expect(documents).toHaveLength(1);
    }, 15000);

    const manualCases = ['GET', 'POST'].flatMap((method) => [false, true].flatMap((rewritten) => ['#row', '#'].map((fragment) => ({ method, rewritten, fragment }))));
    test.each(manualCases)('manual $method retry preserves query bytes and $fragment (rewritten=$rewritten)', async ({ method, rewritten, fragment }) => {
        const capturedURL = 'https://shell-boot.invalid/failed?tag=a+b&tag=a%20b&encoded=%2f&empty=&bare&tag=%26' + fragment;
        let manualRetry = false;
        await context.route('**/*', async (route) => {
            const request = route.request();
            if (!request.isNavigationRequest()) { await route.abort(); return; }
            documents.push({ method: request.method(), url: request.url(), body: request.postData() });
            const landing = new URL(request.url()).pathname === '/post-entry';
            await route.fulfill({ contentType: 'text/html', body: manualRetry ? '<!DOCTYPE html><p id="loaded">Loaded</p>' : landing
                ? `<form action="${capturedURL}" method="post"><input name="password" value="post-secret"><button>Submit</button></form>`
                : failureDocument(request.method(), false) });
        });
        if (method === 'POST') { await page.goto('https://shell-boot.invalid/post-entry'); await page.locator('form button').click(); }
        else { await page.goto(capturedURL); }
        await page.locator('#shell-boot-reload').waitFor({ state: 'visible' });
        const before = documents.length;
        expect(before).toBe(2);
        const historyLength = await page.evaluate((rewrite) => {
            history.replaceState({ fixture: 'preserved' }, '', rewrite ? '/normalized?tag=changed#other' : location.href);
            return history.length;
        }, rewritten);
        const budget = await page.evaluate((url) => sessionStorage.getItem('__filterest_shell_boot_retry_v1:' + url), capturedURL);
        if (method === 'GET') expect(JSON.parse(budget).unresolved).toBe(true);
        manualRetry = true; await page.locator('#shell-boot-reload').click();
        await page.locator('#loaded').waitFor();
        await expect.poll(() => documents.length).toBe(before + 1);
        expect(documents.at(-1)).toEqual({ method: 'GET', url: capturedURL.split('#')[0], body: null });
        await expect.poll(() => page.url()).toBe(capturedURL);
        expect(await page.evaluate(() => history.length)).toBe(historyLength);
        expect(await page.evaluate((url) => sessionStorage.getItem('__filterest_shell_boot_retry_v1:' + url), capturedURL)).toBe(budget);
        await page.waitForTimeout(1800); expect(documents).toHaveLength(before + 1);
    }, 15000);

    test.each(['GET', 'POST'])('cancelled manual %s navigation restores the previous address and state', async (method) => {
        await context.route('**/*', async (route) => {
            const request = route.request();
            if (!request.isNavigationRequest()) { await route.abort(); return; }
            documents.push(request.method());
            await route.fulfill({ contentType: 'text/html', body: new URL(request.url()).pathname === '/post-entry'
                ? `<form action="${initialURL}" method="post"><input name="password" value="post-secret"><button>Submit</button></form>`
                : failureDocument(request.method(), false) });
        });
        if (method === 'POST') { await page.goto('https://shell-boot.invalid/post-entry'); await page.locator('form button').click(); }
        else { await page.goto(initialURL); }
        await page.locator('#shell-boot-reload').waitFor({ state: 'visible' });
        const previous = await page.evaluate((get) => {
            history.replaceState({ fixture: 'preserved' }, '', get ? '/normalized?lang=en#other' : location.href);
            window.addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = ''; });
            return { url: location.href, state: history.state, length: history.length };
        }, method === 'GET');
        const budget = await page.evaluate((url) => sessionStorage.getItem('__filterest_shell_boot_retry_v1:' + url), initialURL);
        let cancellations = 0;
        page.on('dialog', async (dialog) => { cancellations++; await dialog.dismiss(); });
        const before = documents.length;
        await page.locator('#shell-boot-reload').click({ noWaitAfter: true });
        await expect.poll(() => cancellations).toBe(1);
        await expect.poll(() => page.url()).toBe(previous.url);
        expect(await page.evaluate(() => ({ state: history.state, length: history.length }))).toEqual({ state: previous.state, length: previous.length });
        expect(await page.evaluate((url) => sessionStorage.getItem('__filterest_shell_boot_retry_v1:' + url), initialURL)).toBe(budget);
        expect(documents).toHaveLength(before);
    }, 15000);
});
