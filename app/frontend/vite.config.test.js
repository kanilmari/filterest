// vite.config.test.js
// Verifies dev-server routing decisions that run before the SPA bootstraps.
// Bridges Vite root requests, backend auth-mode state, and forced-login redirects.
// Exists so localhost:5173/ mirrors the backend root login-to-browse contract.
// @vitest-environment node

import { describe, expect, test } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import viteConfig, {
  isRootDocumentRequest,
  renderGoTemplateForDev,
  shouldRedirectDevRootToStandaloneLogin,
} from './vite.config.mjs';

function request(method, url) {
  return { method, url };
}

describe('vite forced-login root redirect helpers', () => {
  test('matches plain root document GET and HEAD requests only', () => {
    expect(isRootDocumentRequest(request('GET', '/'))).toBe(true);
    expect(isRootDocumentRequest(request('HEAD', '/'))).toBe(true);
    expect(isRootDocumentRequest(request('POST', '/'))).toBe(false);
    expect(isRootDocumentRequest(request('GET', '/login'))).toBe(false);
    expect(isRootDocumentRequest(request('GET', '/service_catalog'))).toBe(false);
  });

  test('keeps explicit SPA auth-entry roots out of the standalone redirect', () => {
    expect(isRootDocumentRequest(request('GET', '/?login-entry=1'))).toBe(false);
    expect(isRootDocumentRequest(request('GET', '/?register-entry=1'))).toBe(false);
  });

  test('redirects only unauthenticated forced-login auth modes', () => {
    expect(shouldRedirectDevRootToStandaloneLogin({
      login_required_for_browse: true,
      needs_button: 'login',
    })).toBe(true);
    expect(shouldRedirectDevRootToStandaloneLogin({
      login_required_for_browse: true,
      needs_button: 'logout',
    })).toBe(false);
    expect(shouldRedirectDevRootToStandaloneLogin({
      login_required_for_browse: false,
      needs_button: 'login',
    })).toBe(false);
    expect(shouldRedirectDevRootToStandaloneLogin(null)).toBe(false);
  });
});

describe('vite Go-template development rendering', () => {
  test('selects only matching equality-conditional defaults', () => {
    const html = [
      '<input value="dev" {{if eq .Environment "dev"}}checked{{end}}>',
      '<input value="test" {{if eq .Environment "test"}}checked{{end}}>',
      '<input value="none" {{if eq .VerificationMethod "none"}}checked{{end}}>',
      '<input value="email" {{if eq .VerificationMethod "email"}}checked{{end}}>',
    ].join('');

    expect(renderGoTemplateForDev(html)).toBe([
      '<input value="dev" checked>',
      '<input value="test" >',
      '<input value="none" checked>',
      '<input value="email" >',
    ].join(''));
  });
});

describe('vite backend-owned asset routing', () => {
  test('proxies metadata symbols through the Go backend in development', () => {
    const config = viteConfig({ command: 'serve' });

    expect(config.server.proxy).toHaveProperty('/symbol-assets');
  });

  test('always writes production bundles beside the canonical frontend source', () => {
    const config = viteConfig({ command: 'build' });
    const frontendRoot = fileURLToPath(new URL('.', import.meta.url));

    expect(config.build.outDir).toBe(resolve(frontendRoot, 'dist'));
  });
});
