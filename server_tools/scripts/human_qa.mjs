// human_qa.mjs - Human acceptance handoff helper.
// Bridges ticket IDs, exact test targets, Playwright auth state, and concise
// acceptance checklists into one repeatable command.
// Exists so humans can start final QA from a prepared browser and summary.

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { chromium } from "@playwright/test";
import { authStatePathForTarget, isLocalEaselectUrl } from "./local_easelect_target.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const defaultAuthState = path.join(repoRoot, "testing/e2e/.auth/user.json");
const defaultArtifactRoot = path.join(repoRoot, "agent_tasks/_artifacts/human_qa");
const defaultViewport = { width: 1440, height: 900, name: "desktop" };

function usage() {
    return `Usage:
  ./filterest audit human open <ticket-id> [options]
  ./filterest audit human prep <ticket-id> [options]

Options:
  --url <URL|route>          Browser target. Routes like /service_catalog use https://localhost:8082.
  --file <path>              File target to open in the browser.
  --new <text>               What is new in this QA pass, repeatable.
  --easier <text>            What should now be easier or possible, repeatable.
  --how <text>               Concrete human test instruction, repeatable.
  --check <text>             Human acceptance checklist item, repeatable.
  --note <text>              Context note, repeatable.
  --qa <text>                Agent verification evidence, repeatable.
  --command <text>           Manual command/check to show in the handoff, repeatable.
  --title <text>             Override handoff title.
  --output-dir <path>        Artifact directory. Defaults under agent_tasks/_artifacts/human_qa/.
  --viewport <WxH|desktop|mobile|tablet>
  --auth-state <path>        Playwright storageState JSON. Default: per-target under testing/e2e/.auth/.
  --no-auth-state            Do not reuse auth state.
  --no-ensure-login          Do not verify/refresh local Easelect login before opening the target.
  --no-open                  Write and print the handoff without opening Chromium.
  --foreground               Keep the browser launcher attached to this terminal.
  --headless                 Open headless; useful for smoke-testing the helper.
  --help                     Show this help.

Examples:
  ./filterest audit human open 837 --url /service_catalog --new "Firefox card media was fixed" --easier "The exact service catalog route opens ready for acceptance" --how "Inspect the Firefox card in card view" --check "Firefox card shows one logo"
  ./filterest audit human prep 834 --file ../filterest/docs/publication/PUBLICATION_CHECKLIST.md --new "Filterest release checklist is ready" --easier "The exact checklist file opens in the browser" --how "Review every unchecked row" --check "License row is approved"`;
}

function parseArgs(argv) {
    const options = {
        command: "open",
        ticketId: null,
        target: null,
        newItems: [],
        easierItems: [],
        howItems: [],
        checks: [],
        notes: [],
        qa: [],
        commands: [],
        title: null,
        outputDir: null,
        viewport: defaultViewport,
        authState: defaultAuthState,
        authStateExplicit: false,
        useAuthState: true,
        ensureLogin: true,
        openBrowser: true,
        foreground: false,
        headless: false,
    };

    if (argv[0] === "serve-browser") {
        return { command: "serve-browser", sessionPath: argv[1] };
    }

    if (argv[0] === "open" || argv[0] === "prep") {
        options.command = argv.shift();
        options.openBrowser = options.command === "open";
    }

    if (argv[0] && !argv[0].startsWith("-")) {
        options.ticketId = argv.shift();
    }

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = () => {
            index += 1;
            if (index >= argv.length) {
                throw new Error(`missing value for ${arg}`);
            }
            return argv[index];
        };

        if (arg === "--help" || arg === "-h") {
            options.help = true;
        } else if (arg === "--url") {
            setTarget(options, next(), "url");
        } else if (arg.startsWith("--url=")) {
            setTarget(options, arg.slice("--url=".length), "url");
        } else if (arg === "--file") {
            setTarget(options, next(), "file");
        } else if (arg.startsWith("--file=")) {
            setTarget(options, arg.slice("--file=".length), "file");
        } else if (arg === "--new") {
            options.newItems.push(next());
        } else if (arg.startsWith("--new=")) {
            options.newItems.push(arg.slice("--new=".length));
        } else if (arg === "--easier") {
            options.easierItems.push(next());
        } else if (arg.startsWith("--easier=")) {
            options.easierItems.push(arg.slice("--easier=".length));
        } else if (arg === "--how") {
            options.howItems.push(next());
        } else if (arg.startsWith("--how=")) {
            options.howItems.push(arg.slice("--how=".length));
        } else if (arg === "--check") {
            options.checks.push(next());
        } else if (arg.startsWith("--check=")) {
            options.checks.push(arg.slice("--check=".length));
        } else if (arg === "--note") {
            options.notes.push(next());
        } else if (arg.startsWith("--note=")) {
            options.notes.push(arg.slice("--note=".length));
        } else if (arg === "--qa") {
            options.qa.push(next());
        } else if (arg.startsWith("--qa=")) {
            options.qa.push(arg.slice("--qa=".length));
        } else if (arg === "--command") {
            options.commands.push(next());
        } else if (arg.startsWith("--command=")) {
            options.commands.push(arg.slice("--command=".length));
        } else if (arg === "--title") {
            options.title = next();
        } else if (arg.startsWith("--title=")) {
            options.title = arg.slice("--title=".length);
        } else if (arg === "--output-dir") {
            options.outputDir = path.resolve(next());
        } else if (arg.startsWith("--output-dir=")) {
            options.outputDir = path.resolve(arg.slice("--output-dir=".length));
        } else if (arg === "--viewport") {
            options.viewport = parseViewport(next());
        } else if (arg.startsWith("--viewport=")) {
            options.viewport = parseViewport(arg.slice("--viewport=".length));
        } else if (arg === "--auth-state") {
            options.authState = path.resolve(next());
            options.authStateExplicit = true;
        } else if (arg.startsWith("--auth-state=")) {
            options.authState = path.resolve(arg.slice("--auth-state=".length));
            options.authStateExplicit = true;
        } else if (arg === "--no-auth-state") {
            options.useAuthState = false;
        } else if (arg === "--no-ensure-login") {
            options.ensureLogin = false;
        } else if (arg === "--no-open") {
            options.openBrowser = false;
        } else if (arg === "--foreground") {
            options.foreground = true;
        } else if (arg === "--headless") {
            options.headless = true;
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }

    return options;
}

function parseViewport(value) {
    const named = {
        desktop: defaultViewport,
        tablet: { width: 1024, height: 768, name: "tablet" },
        mobile: { width: 390, height: 844, name: "mobile" },
    };
    if (named[value]) {
        return named[value];
    }
    const match = value.match(/^(\d{3,5})x(\d{3,5})$/i);
    if (!match) {
        throw new Error(`invalid viewport "${value}"`);
    }
    return {
        width: Number.parseInt(match[1], 10),
        height: Number.parseInt(match[2], 10),
        name: `${match[1]}x${match[2]}`,
    };
}

function resolveTarget(rawValue, mode) {
    const value = rawValue.trim();
    if (!value) {
        throw new Error("target is empty");
    }
    if (mode === "file") {
        return pathToFileURL(path.resolve(repoRoot, value)).toString();
    }
    if (/^https?:\/\//i.test(value) || /^file:\/\//i.test(value)) {
        return value;
    }
    if (value.startsWith("/")) {
        return `https://localhost:8082${value}`;
    }
    const candidatePath = path.resolve(repoRoot, value);
    if (fs.existsSync(candidatePath)) {
        return pathToFileURL(candidatePath).toString();
    }
    return `https://localhost:8082/${value}`;
}

function setTarget(options, rawValue, mode) {
    options.target = resolveTarget(rawValue, mode);
    if (!options.authStateExplicit) {
        options.authState = authStatePathForTarget(repoRoot, options.target, defaultAuthState);
    }
}

function artifactDirFor(options) {
    if (options.outputDir) {
        return options.outputDir;
    }
    const now = new Date();
    const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
    ].join("-") + "--" + [
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
    ].join("-");
    const ticket = options.ticketId ? `ticket-${options.ticketId}` : "no-ticket";
    return path.join(defaultArtifactRoot, `${stamp}--${ticket}`);
}

function buildSession(options) {
    const outputDir = artifactDirFor(options);
    fs.mkdirSync(outputDir, { recursive: true });
    const title = options.title || `Human QA handoff${options.ticketId ? ` for #${options.ticketId}` : ""}`;
    const localTarget = Boolean(options.target && isLocalEaselectUrl(options.target));
    const authStatePath = options.useAuthState
        && options.target
        && localTarget
        ? options.authState
        : null;
    const initialAuthStatePath = authStatePath && fs.existsSync(authStatePath) ? authStatePath : null;

    const sessionPath = path.join(outputDir, "human_qa_session.json");
    const markdownPath = path.join(outputDir, "human_qa_instructions.md");
    const htmlPath = path.join(outputDir, "human_qa_instructions.html");
    const runtimeStatusPath = path.join(outputDir, "human_qa_runtime_status.json");
    const session = {
        title,
        ticketId: options.ticketId,
        target: options.target,
        newItems: options.newItems,
        easierItems: options.easierItems,
        howItems: options.howItems,
        checks: options.checks,
        notes: options.notes,
        qa: options.qa,
        commands: options.commands,
        viewport: options.viewport,
        authStatePath,
        initialAuthStatePath,
        ensureLogin: Boolean(options.ensureLogin && localTarget),
        outputDir,
        sessionPath,
        markdownPath,
        htmlPath,
        runtimeStatusPath,
        headless: options.headless,
        createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2) + "\n", "utf8");
    fs.writeFileSync(markdownPath, renderMarkdown(session), "utf8");
    fs.writeFileSync(htmlPath, renderHtml(session), "utf8");
    writeRuntimeStatus(session, { status: "planned", target: session.target });
    return session;
}

function sectionItems(items, fallback) {
    return items.length ? items : [fallback];
}

function getNewItems(session) {
    return sectionItems(
        session.newItems || [],
        "A prepared human QA handoff is ready for this ticket.",
    );
}

function getEasierItems(session) {
    return sectionItems(
        session.easierItems || [],
        "The browser target, instructions, checklist, and evidence are collected in one place.",
    );
}

function getHowItems(session) {
    return sectionItems(
        session.howItems || [],
        "Open the prepared target, run the checklist below, and report the first concrete failing item if acceptance should not pass.",
    );
}

function renderMarkdown(session) {
    const checks = session.checks.length
        ? session.checks
        : ["Confirm the changed behavior matches the ticket and no obvious regression is visible."];
    const newItems = getNewItems(session);
    const easierItems = getEasierItems(session);
    const howItems = getHowItems(session);
    const lines = [
        `# ${session.title}`,
        "",
        `- Ticket: ${session.ticketId ? `#${session.ticketId}` : "(none)"}`,
        `- Target: ${session.target || "(no browser target)"}`,
        `- Auth: ${session.ensureLogin ? "verified/refreshed before local target opens" : (session.authStatePath || "(not used)")}`,
        `- Created: ${session.createdAt}`,
        "",
        "## What Is New",
        "",
        ...newItems.map((item) => `- ${item}`),
        "",
        "## What Should Be Easier Now",
        "",
        ...easierItems.map((item) => `- ${item}`),
        "",
        "## How To Test",
        "",
        ...howItems.map((item) => `- ${item}`),
        "",
        "## Human Acceptance Checklist",
        "",
        ...checks.map((item) => `- [ ] ${item}`),
    ];
    if (session.notes.length) {
        lines.push("", "## Notes", "", ...session.notes.map((item) => `- ${item}`));
    }
    if (session.qa.length) {
        lines.push("", "## Agent Verification Evidence", "", ...session.qa.map((item) => `- ${item}`));
    }
    if (session.commands.length) {
        lines.push("", "## Manual Commands / Checks", "", ...session.commands.map((item) => `- \`${item}\``));
    }
    lines.push(
        "",
        "## Decision",
        "",
        "- Accept if all relevant checklist items pass.",
        "- Reject or request follow-up with the first concrete failing item.",
        "",
    );
    return `${lines.join("\n")}\n`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderHtml(session) {
    const checks = session.checks.length
        ? session.checks
        : ["Confirm the changed behavior matches the ticket and no obvious regression is visible."];
    const newItems = getNewItems(session);
    const easierItems = getEasierItems(session);
    const howItems = getHowItems(session);
    const list = (items, checkbox = false) => items.map((item) => (
        `<li>${checkbox ? '<input type="checkbox"> ' : ""}${escapeHtml(item)}</li>`
    )).join("\n");
    const commandList = (items) => items.map((item) => (
        `<li><code>${escapeHtml(item)}</code></li>`
    )).join("\n");
    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${escapeHtml(session.title)}</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 900px; margin: 32px auto; line-height: 1.45; color: #1f2937; }
code { background: #f3f4f6; padding: 0.12rem 0.32rem; border-radius: 4px; }
li { margin: 0.45rem 0; }
</style>
<h1>${escapeHtml(session.title)}</h1>
<p><strong>Ticket:</strong> ${session.ticketId ? `#${escapeHtml(session.ticketId)}` : "(none)"}</p>
<p><strong>Target:</strong> ${escapeHtml(session.target || "(no browser target)")}</p>
<p><strong>Auth:</strong> ${escapeHtml(session.ensureLogin ? "verified/refreshed before local target opens" : (session.authStatePath || "(not used)"))}</p>
<h2>What Is New</h2>
<ul>${list(newItems)}</ul>
<h2>What Should Be Easier Now</h2>
<ul>${list(easierItems)}</ul>
<h2>How To Test</h2>
<ul>${list(howItems)}</ul>
<h2>Human Acceptance Checklist</h2>
<ul>${list(checks, true)}</ul>
${session.notes.length ? `<h2>Notes</h2><ul>${list(session.notes)}</ul>` : ""}
${session.qa.length ? `<h2>Agent Verification Evidence</h2><ul>${list(session.qa)}</ul>` : ""}
${session.commands.length ? `<h2>Manual Commands / Checks</h2><ul>${commandList(session.commands)}</ul>` : ""}
</html>`;
}

function printSummary(session, launchResult) {
    const checks = session.checks.length
        ? session.checks
        : ["Confirm the changed behavior matches the ticket and no obvious regression is visible."];
    console.log(`Human QA handoff: ${session.title}`);
    console.log(`- Target: ${session.target || "(no browser target)"}`);
    console.log(`- Instructions: ${session.markdownPath}`);
    console.log(`- Browser instructions page: ${session.htmlPath}`);
    console.log(`- Runtime status: ${session.runtimeStatusPath}`);
    if (session.ensureLogin) {
        const authPath = session.authStatePath ? path.relative(repoRoot, session.authStatePath) : "(in-memory only)";
        console.log(`- Auth: verifies and refreshes local login (${authPath})`);
    } else if (session.authStatePath) {
        console.log(`- Auth: ${path.relative(repoRoot, session.authStatePath)}`);
    }
    if (launchResult) {
        console.log(`- Browser: ${launchResult}`);
    }
    console.log("");
    console.log("What is new:");
    for (const item of getNewItems(session)) {
        console.log(`- ${item}`);
    }
    console.log("");
    console.log("What should be easier now:");
    for (const item of getEasierItems(session)) {
        console.log(`- ${item}`);
    }
    console.log("");
    console.log("How to test:");
    for (const item of getHowItems(session)) {
        console.log(`- ${item}`);
    }
    console.log("");
    console.log("Checklist:");
    for (const item of checks) {
        console.log(`- [ ] ${item}`);
    }
}

function writeRuntimeStatus(session, status) {
    if (!session.runtimeStatusPath) {
        return;
    }
    const payload = {
        updatedAt: new Date().toISOString(),
        ...status,
    };
    fs.writeFileSync(session.runtimeStatusPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function loadTestCredentials() {
    const credentialPath = path.join(repoRoot, "dev_env_test_creds.txt");
    const raw = fs.readFileSync(credentialPath, "utf8");
    const values = new Map();
    for (const line of raw.split(/\r?\n/)) {
        const match = line.match(/^([^=#]+)=(.*)$/);
        if (match) {
            values.set(match[1].trim(), match[2].trim());
        }
    }
    const username = values.get("TEST_ADMIN_USER") || "";
    const password = values.get("TEST_ADMIN_PASS") || "";
    if (!username || !password) {
        throw new Error("missing TEST_ADMIN_USER or TEST_ADMIN_PASS in dev_env_test_creds.txt");
    }
    return { username, password };
}

async function readUserProfile(page) {
    return page.evaluate(async () => {
        const response = await fetch("/api/user-profile", { credentials: "include" });
        if (!response.ok) {
            return {};
        }
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            return {};
        }
        try {
            return await response.json();
        } catch (_error) {
            return {};
        }
    });
}

function isAuthenticatedProfile(profile, expectedUsername) {
    const userId = typeof profile.user_id === "number" ? profile.user_id : 0;
    const username = typeof profile.username === "string" ? profile.username : "";
    return userId > 1 && (!expectedUsername || !username || username === expectedUsername);
}

function targetRedirectPath(target) {
    const parsed = new URL(target);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function openLoginEntry(page, session) {
    const loginUrl = new URL("/", session.target);
    loginUrl.searchParams.set("login-entry", "1");
    loginUrl.searchParams.set("redirect", targetRedirectPath(session.target));
    await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('[data-testid="login-form"]').waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-testid="login-username"]').waitFor({ state: "visible", timeout: 15000 });
}

async function waitForAuthenticatedApp(page, expectedUsername) {
    await page.waitForFunction(
        async (username) => {
            const response = await fetch("/api/user-profile", { credentials: "include" });
            if (!response.ok) {
                return false;
            }
            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                return false;
            }
            let data = {};
            try {
                data = await response.json();
            } catch (_error) {
                return false;
            }
            const userId = typeof data.user_id === "number" ? data.user_id : 0;
            const sessionUsername = typeof data.username === "string" ? data.username : "";
            return userId > 1 && (!username || !sessionUsername || sessionUsername === username);
        },
        expectedUsername || "",
        { timeout: 15000 },
    );
    await page.waitForSelector('[data-testid^="tab-"]', { timeout: 15000 });
}

async function performLocalLogin(page, session, credentials) {
    await openLoginEntry(page, session);
    await page.locator('[data-testid="login-username"]').fill(credentials.username);
    await page.locator('[data-testid="login-password"]').fill(credentials.password);
    const privacyCheckbox = page.locator('[data-testid="login-privacy-accept"]');
    if (!(await privacyCheckbox.isChecked())) {
        await privacyCheckbox.check();
    }
    await page.locator('[data-testid="login-submit"]').click();
    await page.locator('[data-testid="login-otp-section"]').waitFor({ state: "visible", timeout: 10000 });
    await page.locator('[data-testid="login-otp"]').fill("334726");
    await page.locator('[data-testid="login-submit"]').click();
    await waitForAuthenticatedApp(page, credentials.username);
}

async function ensureLocalAuthenticated(page, context, session) {
    const credentials = loadTestCredentials();
    const rootUrl = new URL("/", session.target).toString();
    await page.goto(rootUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(500);
    const existingProfile = await readUserProfile(page);
    if (isAuthenticatedProfile(existingProfile, credentials.username)) {
        return { status: "authenticated", refreshed: false, username: existingProfile.username || credentials.username };
    }

    await performLocalLogin(page, session, credentials);
    const profile = await readUserProfile(page);
    if (!isAuthenticatedProfile(profile, credentials.username)) {
        throw new Error("local login completed without an authenticated test-admin session");
    }
    if (session.authStatePath) {
        fs.mkdirSync(path.dirname(session.authStatePath), { recursive: true });
        await context.storageState({ path: session.authStatePath });
    }
    return { status: "authenticated", refreshed: true, username: profile.username || credentials.username };
}

function launchDetachedBrowser(session) {
    if (!session.target) {
        return "not opened (no target)";
    }
    const logPath = path.join(session.outputDir, "browser.log");
    const logFd = fs.openSync(logPath, "a");
    const child = spawn(
        process.execPath,
        [__filename, "serve-browser", session.sessionPath],
        {
            cwd: repoRoot,
            detached: true,
            stdio: ["ignore", logFd, logFd],
        },
    );
    child.unref();
    fs.closeSync(logFd);
    return `detached pid ${child.pid}, log ${logPath}`;
}

async function runBrowserSession(sessionPath) {
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    if (!session.target) {
        return;
    }
    const localTarget = isLocalEaselectUrl(session.target);
    writeRuntimeStatus(session, { status: "launching", target: session.target });
    const browser = await chromium.launch({
        headless: Boolean(session.headless),
        args: [`--window-size=${session.viewport.width},${session.viewport.height}`],
    });
    try {
        const storageState = session.initialAuthStatePath
            || (session.authStatePath && fs.existsSync(session.authStatePath) ? session.authStatePath : undefined);
        const context = await browser.newContext({
            viewport: { width: session.viewport.width, height: session.viewport.height },
            storageState,
            ignoreHTTPSErrors: true,
            extraHTTPHeaders: localTarget ? { "X-Bypass-Ratelimit": "test-mode" } : {},
        });
        const targetPage = await context.newPage();
        let authStatus = { status: "not_applicable" };
        if (localTarget && session.ensureLogin) {
            try {
                authStatus = await ensureLocalAuthenticated(targetPage, context, session);
            } catch (error) {
                authStatus = { status: "login_failed", error: error.message };
                writeRuntimeStatus(session, { ...authStatus, target: session.target });
                if (session.headless) {
                    throw error;
                }
            }
        }
        await targetPage.goto(session.target, { waitUntil: "domcontentloaded", timeout: 60000 });
        await targetPage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        const instructionsPage = await context.newPage();
        await instructionsPage.goto(pathToFileURL(session.htmlPath).toString(), { waitUntil: "domcontentloaded" });
        await targetPage.bringToFront();
        writeRuntimeStatus(session, {
            status: "ready",
            target: session.target,
            finalUrl: targetPage.url(),
            auth: authStatus,
            instructions: session.htmlPath,
        });
        if (session.headless) {
            await browser.close();
            return;
        }
        await new Promise((resolve) => {
            browser.on("disconnected", resolve);
        });
    } catch (error) {
        writeRuntimeStatus(session, { status: "failed", target: session.target, error: error.message });
        await browser.close();
        throw error;
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(usage());
        return;
    }
    if (args.command === "serve-browser") {
        if (!args.sessionPath) {
            throw new Error("serve-browser requires a session path");
        }
        await runBrowserSession(args.sessionPath);
        return;
    }
    if (!args.ticketId) {
        throw new Error("missing <ticket-id>; use 0 for non-ticket handoffs");
    }
    const session = buildSession(args);
    let launchResult = null;
    if (args.openBrowser) {
        if (args.foreground || args.headless) {
            await runBrowserSession(session.sessionPath);
            launchResult = args.headless ? "opened headless and closed after smoke navigation" : "foreground session closed";
        } else {
            launchResult = launchDetachedBrowser(session);
        }
    }
    printSummary(session, launchResult);
}

main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
});
