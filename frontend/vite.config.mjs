// vite.config.mjs
// Configures the frontend build pipeline for local development and production bundling.
// Bridges Vite's dev/build workflow with Easelect's Go template and CSP placeholder requirements.
//
// Dev mode (npm run dev):
//   - Vite dev server at http://localhost:5173 with HMR by default
//   - Proxies /api, /login, /logout, /storage, /apps, /admin to the configured Go backend
//   - Auto-scans all HTML files for Go template vars and replaces with dev defaults
//
// Build mode (npm run build):
//   - Production bundle to frontend/dist/ with hashed filenames
//   - base: /frontend/ for Go backend static serving

import { defineConfig } from 'vite';
import http from 'http';
import https from 'https';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  isPrivateEaselectSourceCheckout,
  resolveEaselectPrivatePaths,
} from '../server_tools/lib/easelect_private_paths.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');
const privatePaths = resolveEaselectPrivatePaths(projectRoot);

function readProjectEnvValue(key) {
  if (process.env[key]) return process.env[key];

  const runtimeEnvFiles = isPrivateEaselectSourceCheckout(projectRoot)
    ? [privatePaths.developmentEnvFile, privatePaths.runtimeEnvFile]
    : [privatePaths.runtimeEnvFile, privatePaths.developmentEnvFile];
  for (const envFileName of [
    ...runtimeEnvFiles,
    join(projectRoot, '.env.scaffold'),
    join(projectRoot, 'dev_env.scaffold'),
  ]) {
    try {
      const envContent = readFileSync(envFileName, 'utf-8');
      for (const rawLine of envContent.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIndex = line.indexOf('=');
        if (eqIndex === -1) continue;
        const name = line.slice(0, eqIndex).trim();
        if (name !== key) continue;
        const value = line.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        if (value) return value;
      }
    } catch {
      // Try the next local env/scaffold file.
    }
  }

  return '';
}

function isGeneratedFilterestCheckout() {
  try {
    readFileSync(join(projectRoot, 'VERSION_APP'), 'utf-8');
  } catch {
    return false;
  }

  try {
    readFileSync(join(projectRoot, 'VERSION_EASELECT'), 'utf-8');
    return false;
  } catch {
    return true;
  }
}

function readProjectVersionAwarePortFallback() {
  return isGeneratedFilterestCheckout() ? 8100 : 8082;
}

function readProjectDefaultSiteName() {
  return isGeneratedFilterestCheckout() ? 'Filterest' : 'Easelect';
}

function readProjectEnvPort(key, fallback) {
  const rawValue = readProjectEnvValue(key);
  if (!rawValue) return fallback;

  const value = Number.parseInt(rawValue, 10);
  if (Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }

  return fallback;
}

function resolveDevBackendURL() {
  const explicitURL = readProjectEnvValue('VITE_BACKEND_URL') || readProjectEnvValue('VITE_GO_BACKEND');
  if (explicitURL) return explicitURL;

  const baseURL = readProjectEnvValue('BASE_URL');
  if (/^https?:\/\//i.test(baseURL)) return baseURL;

  const backendPort = readProjectEnvPort(
    'APP_PORT',
    readProjectEnvPort('PORT', readProjectEnvPort('EASELECT_PORT', readProjectVersionAwarePortFallback())),
  );
  return `https://localhost:${backendPort}`;
}

function resolveDevProjectLogoPath() {
  const storageDir = join(projectRoot, 'storage');

  for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']) {
    const fileName = `project_logo${ext}`;
    try {
      if (statSync(join(storageDir, fileName)).isFile()) {
        return `/storage/${fileName}`;
      }
    } catch {
      // Continue probing supported extensions.
    }
  }

  return '';
}

const DEV_SITE_NAME = readProjectEnvValue('SITE_NAME') || readProjectDefaultSiteName();
const DEV_PROJECT_LOGO_PATH = resolveDevProjectLogoPath();
const VITE_DEV_PORT = readProjectEnvPort('VITE_DEV_PORT', 5173);
const VITE_HMR_PORT = readProjectEnvPort('VITE_HMR_PORT', VITE_DEV_PORT);
const DEV_BACKEND_URL = resolveDevBackendURL();
const DEV_CANONICAL_URL = `http://localhost:${VITE_DEV_PORT}`;
const DEV_PAGE_TITLE = `${DEV_SITE_NAME} Dev`;

function frontendDevAssetRewrite() {
  return {
    name: 'easelect-frontend-dev-asset-rewrite',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith('/frontend/')) {
          req.url = req.url.replace(/^\/frontend(?=\/)/, '');
        }
        next();
      });
    },
  };
}

export function isRootDocumentRequest(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const requestUrl = new URL(req.url || '/', DEV_CANONICAL_URL);
  if (requestUrl.pathname !== '/') return false;
  if (requestUrl.searchParams.get('login-entry') === '1') return false;
  if (requestUrl.searchParams.get('register-entry') === '1') return false;
  return true;
}

function fetchDevBackendAuthModes(cookieHeader = '') {
  return new Promise((resolve) => {
    const targetUrl = new URL('/api/auth-modes', DEV_BACKEND_URL);
    const client = targetUrl.protocol === 'http:' ? http : https;
    const requestOptions = {
      method: 'GET',
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      rejectUnauthorized: false,
      headers: {
        accept: 'application/json',
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
    };

    const request = client.request(requestOptions, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });

    request.on('error', () => resolve(null));
    request.setTimeout(1500, () => {
      request.destroy();
      resolve(null);
    });
    request.end();
  });
}

export function shouldRedirectDevRootToStandaloneLogin(authModes) {
  return authModes?.login_required_for_browse === true
    && authModes?.needs_button === 'login';
}

export function devForcedLoginRootRedirect() {
  return {
    name: 'easelect-dev-forced-login-root-redirect',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!isRootDocumentRequest(req)) {
          next();
          return;
        }

        const authModes = await fetchDevBackendAuthModes(req.headers.cookie || '');
        if (!shouldRedirectDevRootToStandaloneLogin(authModes)) {
          next();
          return;
        }

        res.statusCode = 303;
        res.setHeader('Location', '/login');
        res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate, private');
        res.end('See Other');
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Go Template Auto-Scanner
// Scans all .html files in frontend/ for {{.VarName}} patterns.
// Warns at startup if any template var is missing from KNOWN_DEFAULTS,
// ensuring zero-maintenance: unknown vars are replaced with "" and logged.
// ---------------------------------------------------------------------------

function scanGoTemplateVars(dir) {
  const vars = new Set();
  const scalarRe = /{{\s*\.(\w+)\s*}}/g;
  const condRe = /{{\s*(?:if|if not|if eq)\s+\.(\w+)(?:\s+"[^"]*")?\s*}}/g;

  function walk(d) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== 'dist' && entry !== 'node_modules') walk(full);
      } else if (entry.endsWith('.html')) {
        const content = readFileSync(full, 'utf-8');
        let m;
        while ((m = scalarRe.exec(content))) vars.add(m[1]);
        while ((m = condRe.exec(content))) vars.add(m[1]);
      }
    }
  }
  walk(dir);
  return vars;
}

// Known scalar defaults for dev mode.
// The auto-scanner warns if a new {{.VarName}} appears in any HTML file
// that isn't listed here — but nothing breaks (replaced with "").
const KNOWN_DEFAULTS = {
  CSPNonce: 'dev-nonce',
  CSRFToken: 'dev-csrf-token',
  LangCode: 'fi',
  PageTitle: DEV_PAGE_TITLE,
  SiteName: DEV_SITE_NAME,
  ProductName: DEV_SITE_NAME,
  MetaDescription: '',
  CanonicalURL: DEV_CANONICAL_URL,
  OGType: 'website',
  OGTitle: DEV_PAGE_TITLE,
  OGDescription: '',
  OGURL: DEV_CANONICAL_URL,
  OGImage: '',
  OGLocale: 'fi_FI',
  ProjectLogoPath: DEV_PROJECT_LOGO_PATH,
  FormAction: '/api/register',
  ImportsCSSPath: '/frontend/styles/imports.css',
  MainBundlePath: '/frontend/main.js',
  LoginBundlePath: '/frontend/core_components/auth/login_page_builder.js',
  InstallationEnvironment: 'dev',
  InitialSection: 'settings',
  FirstRunSiteName: '',
  TOTPSecret: 'JBSWY3DPEHPK3PXP',
  Username: '',
  Email: '',
  Environment: 'dev',
  VerificationMethod: 'none',
};

// Conditional vars that evaluate to TRUE in dev mode
const DEV_TRUE_VARS = new Set(['IsDev']);

// All known conditional vars (won't trigger "unknown var" warnings)
const KNOWN_CONDITIONAL_VARS = new Set([
  'UseMinifiedAssets', 'IsDev', 'RobotsNoIndex',
  'StandalonePage', 'ShowCloseButton', 'ShowTourScreenshots',
  'SiteNameErr', 'UsernameErr', 'EmailErr', 'PasswordErr', 'GeneralErr',
  'EnvironmentErr', 'VerificationErr', 'FactorErr',
]);

// ---------------------------------------------------------------------------
// Go Template Transform Plugin
// Converts Go template syntax in index.html to dev-friendly static HTML.
// ---------------------------------------------------------------------------

export function renderGoTemplateForDev(html) {
  let h = html;

  // Equality conditionals provide deterministic radio/select defaults in previews.
  h = h.replace(
    /{{if eq\s+\.(\w+)\s+"([^"]*)"}}((?:(?!{{end}})[\s\S])*?){{else}}([\s\S]*?){{end}}/g,
    (_, variable, expected, ifBlock, elseBlock) => (
      String(KNOWN_DEFAULTS[variable] ?? '') === expected ? ifBlock : elseBlock
    ),
  );
  h = h.replace(
    /{{if eq\s+\.(\w+)\s+"([^"]*)"}}([\s\S]*?){{end}}/g,
    (_, variable, expected, content) => (
      String(KNOWN_DEFAULTS[variable] ?? '') === expected ? content : ''
    ),
  );

  return h;
}

function goTemplateTransform() {
  // Scan all HTML files at plugin init and warn about unknowns
  const allVars = scanGoTemplateVars(__dirname);
  for (const v of allVars) {
    if (!(v in KNOWN_DEFAULTS) && !KNOWN_CONDITIONAL_VARS.has(v)) {
      console.warn(
        `\x1b[33m⚠ Go template var {{.${v}}} found in HTML but has no dev default — will be replaced with ""\x1b[0m`,
      );
    }
  }

  return {
    name: 'easelect-go-template-transform',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let h = renderGoTemplateForDev(html);

        // 1. Remove Go template comments {{/* ... */}}
        h = h.replace(/{{\/\*[\s\S]*?\*\/}}/g, '');

        // 2. Conditionals WITH else — processed first.
        //    The ifBlock uses (?:(?!{{end}})[\s\S])*? to prevent matching
        //    across {{end}} boundaries (e.g. {{if .RobotsNoIndex}}...{{end}}
        //    must not be swallowed as the ifBlock of an unrelated if-else).
        h = h.replace(
          /{{if not\s+\.(\w+)}}((?:(?!{{end}})[\s\S])*?){{else}}([\s\S]*?){{end}}/g,
          (_, v, ifBlock, elseBlock) => (DEV_TRUE_VARS.has(v) ? elseBlock : ifBlock),
        );
        h = h.replace(
          /{{if\s+\.(\w+)}}((?:(?!{{end}})[\s\S])*?){{else}}([\s\S]*?){{end}}/g,
          (_, v, ifBlock, elseBlock) => (DEV_TRUE_VARS.has(v) ? ifBlock : elseBlock),
        );

        // 3. Conditionals WITHOUT else (safe now that if-else blocks are gone)
        h = h.replace(
          /{{if not\s+\.(\w+)}}([\s\S]*?){{end}}/g,
          (_, v, content) => (DEV_TRUE_VARS.has(v) ? '' : content),
        );
        h = h.replace(
          /{{if\s+\.(\w+)}}([\s\S]*?){{end}}/g,
          (_, v, content) => (DEV_TRUE_VARS.has(v) ? content : ''),
        );

        // 4. Scalar vars → known default or ""
        h = h.replace(/{{\s*\.(\w+)\s*}}/g, (_, v) => {
          if (v in KNOWN_DEFAULTS) return KNOWN_DEFAULTS[v];
          console.warn(`\x1b[33m⚠ Unknown Go template var {{.${v}}} — replaced with ""\x1b[0m`);
          return '';
        });

        // 5. Catch-all: remove any remaining Go template syntax
        h = h.replace(/{{[^}]*}}/g, '');

        // 6. Strip /frontend/ prefix (Vite root is frontend/)
        h = h.replace(/(src|href)="\/frontend\//g, '$1="/');

        // 7. Fix public/ paths (Vite serves public/ contents at root)
        h = h.replace(/(src|href)="\/public\//g, '$1="/');

        return h;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Vite Configuration
// ---------------------------------------------------------------------------

const proxyOpts = { target: DEV_BACKEND_URL, changeOrigin: true, secure: false };

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/frontend/' : '/',
  server: {
    port: VITE_DEV_PORT,
    strictPort: true,
    fs: { allow: ['.'] },
    proxy: {
      '/api': proxyOpts,
      '/login': proxyOpts,
      '/logout': proxyOpts,
      '/storage': proxyOpts,
      '/apps': proxyOpts,
      '/admin': proxyOpts,
    },
    hmr: { port: VITE_HMR_PORT },
  },
  plugins: [devForcedLoginRootRedirect(), frontendDevAssetRewrite(), goTemplateTransform()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: new URL('main.js', import.meta.url).pathname,
        login: new URL('core_components/auth/login_page_builder.js', import.meta.url).pathname,
        imports: new URL('styles/imports.css', import.meta.url).pathname,
      },
      output: {
        // Naming pattern: [name].[hash].min.js / .min.css
        entryFileNames: '[name].[hash].min.js',
        chunkFileNames: '[name].[hash].min.js',
        assetFileNames: '[name].[hash].min[extname]',
      },
    },
  },
  // Tuotantobuildeissa poistetaan console.log ja console.info
  // console.error ja console.warn säilytetään virheiden debuggausta varten
  // Ks. DEV_GUIDE.md → "Logging Guidelines" -osio
  esbuild: {
    pure: command === 'build' ? ['console.log', 'console.info'] : [],
  },
}));
