// ai_acceptance_runner.mjs - Browser execution core for AI acceptance tests.
// Bridges Playwright, local Easelect login, structured assertions, and evidence files.
// Returns machine-readable pass/fail/inconclusive results to the CLI coordinator.
// Exists to keep AI acceptance browser work reusable and below script size limits.
/* global document, window */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium, expect } from "@playwright/test";
import { isLocalEaselectUrl } from "./local_easelect_target.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

// Turns a label into a safe path segment for artifact names.
function slugify(value) {
    const slug = String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return slug || "item";
}

// Reads test-admin credentials from the repo-local development credential file.
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

// Reads the current authenticated profile through the application API.
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

// Checks that the browser session belongs to a non-guest test user.
function isAuthenticatedProfile(profile, expectedUsername) {
    const userId = typeof profile.user_id === "number" ? profile.user_id : 0;
    const username = typeof profile.username === "string" ? profile.username : "";
    return userId > 1 && (!expectedUsername || !username || username === expectedUsername);
}

// Builds the redirect path used by the local login modal entry point.
function targetRedirectPath(target) {
    const parsed = new URL(target);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

// Opens the local login modal route and waits until credential fields are ready.
async function openLoginEntry(page, target) {
    const loginUrl = new URL("/", target);
    loginUrl.searchParams.set("login-entry", "1");
    loginUrl.searchParams.set("redirect", targetRedirectPath(target));
    await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('[data-testid="login-form"]').waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-testid="login-username"]').waitFor({ state: "visible", timeout: 15000 });
}

// Waits for the authenticated SPA shell after submitting credentials and OTP.
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

// Performs the same local test-admin login flow used by human_qa open.
async function performLocalLogin(page, target, credentials) {
    await openLoginEntry(page, target);
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

// Reuses or refreshes local auth state before target navigation.
async function ensureLocalAuthenticated(page, context, options) {
    const credentials = loadTestCredentials();
    const rootUrl = new URL("/", options.target).toString();
    await page.goto(rootUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(500);
    const existingProfile = await readUserProfile(page);
    if (isAuthenticatedProfile(existingProfile, credentials.username)) {
        return { status: "authenticated", refreshed: false, username: existingProfile.username || credentials.username };
    }
    await performLocalLogin(page, options.target, credentials);
    const profile = await readUserProfile(page);
    if (!isAuthenticatedProfile(profile, credentials.username)) {
        throw new Error("local login completed without an authenticated test-admin session");
    }
    if (options.useAuthState && options.authState) {
        fs.mkdirSync(path.dirname(options.authState), { recursive: true });
        await context.storageState({ path: options.authState });
    }
    return { status: "authenticated", refreshed: true, username: profile.username || credentials.username };
}

// Attaches browser event listeners that capture console and network evidence.
function installEvidenceListeners(page, evidence) {
    page.on("console", (message) => {
        evidence.console.push({
            type: message.type(),
            text: message.text(),
            location: message.location(),
            timestamp: new Date().toISOString(),
        });
    });
    page.on("pageerror", (error) => {
        evidence.pageErrors.push({
            message: error.message,
            stack: error.stack || "",
            timestamp: new Date().toISOString(),
        });
    });
    page.on("requestfailed", (request) => {
        evidence.requestFailures.push({
            method: request.method(),
            url: request.url(),
            resourceType: request.resourceType(),
            failure: request.failure()?.errorText || "",
            timestamp: new Date().toISOString(),
        });
    });
    page.on("response", (response) => {
        const status = response.status();
        if (status >= 400) {
            evidence.httpErrors.push({
                status,
                url: response.url(),
                requestMethod: response.request().method(),
                timestamp: new Date().toISOString(),
            });
        }
    });
}

// Executes one plan step and converts Playwright exceptions into step results.
async function executeStep(page, step, options, outputDir, index) {
    const startedAt = new Date().toISOString();
    const base = {
        index,
        type: step.type,
        description: step.description || describeStep(step),
        source: step.source || "plan",
        startedAt,
    };
    try {
        if (step.type === "click") {
            await page.locator(required(step.selector, "selector")).click({ timeout: options.timeoutMs });
            await page.waitForTimeout(options.settleMs);
            return { ...base, status: "pass", finishedAt: new Date().toISOString() };
        }
        if (step.type === "fill") {
            await page.locator(required(step.selector, "selector")).fill(String(step.value ?? ""), { timeout: options.timeoutMs });
            await page.waitForTimeout(options.settleMs);
            return { ...base, status: "pass", finishedAt: new Date().toISOString() };
        }
        if (step.type === "press") {
            await page.locator(required(step.selector, "selector")).press(required(step.key, "key"), { timeout: options.timeoutMs });
            await page.waitForTimeout(options.settleMs);
            return { ...base, status: "pass", finishedAt: new Date().toISOString() };
        }
        if (step.type === "waitForSelector") {
            await page.locator(required(step.selector, "selector")).waitFor({
                state: step.state || "visible",
                timeout: options.timeoutMs,
            });
            return { ...base, status: "pass", finishedAt: new Date().toISOString() };
        }
        if (step.type === "assertText") {
            const target = step.selector ? page.locator(step.selector) : page.locator("body");
            await expect(target).toContainText(required(step.text, "text"), { timeout: options.timeoutMs });
            return { ...base, status: "pass", assertion: true, finishedAt: new Date().toISOString() };
        }
        if (step.type === "assertNoText") {
            const target = step.selector ? page.locator(step.selector) : page.locator("body");
            await expect(target).not.toContainText(required(step.text, "text"), { timeout: options.timeoutMs });
            return { ...base, status: "pass", assertion: true, finishedAt: new Date().toISOString() };
        }
        if (step.type === "assertVisible") {
            await expect(page.locator(required(step.selector, "selector")).first()).toBeVisible({ timeout: options.timeoutMs });
            return { ...base, status: "pass", assertion: true, finishedAt: new Date().toISOString() };
        }
        if (step.type === "assertHidden") {
            await expect(page.locator(required(step.selector, "selector")).first()).toBeHidden({ timeout: options.timeoutMs });
            return { ...base, status: "pass", assertion: true, finishedAt: new Date().toISOString() };
        }
        if (step.type === "assertUrlContains") {
            const text = required(step.text, "text");
            if (!page.url().includes(text)) {
                throw new Error(`expected final URL to contain "${text}", got ${page.url()}`);
            }
            return { ...base, status: "pass", assertion: true, finishedAt: new Date().toISOString() };
        }
        if (step.type === "assertUrlMatches") {
            const pattern = new RegExp(required(step.pattern, "pattern"));
            if (!pattern.test(page.url())) {
                throw new Error(`expected final URL to match /${step.pattern}/, got ${page.url()}`);
            }
            return { ...base, status: "pass", assertion: true, finishedAt: new Date().toISOString() };
        }
        if (step.type === "screenshot") {
            const name = slugify(step.name || `step-${index}`);
            const screenshotPath = path.join(outputDir, `screenshot-${name}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            return {
                ...base,
                status: "pass",
                artifact: relativePath(screenshotPath),
                finishedAt: new Date().toISOString(),
            };
        }
        return {
            ...base,
            status: "inconclusive",
            error: `unsupported step type: ${step.type || "(missing)"}`,
            finishedAt: new Date().toISOString(),
        };
    } catch (error) {
        return {
            ...base,
            status: "fail",
            error: formatStepError(error),
            finishedAt: new Date().toISOString(),
        };
    }
}

// Keeps Playwright assertion output useful without embedding the full page text.
function formatStepError(error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const compact = rawMessage
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    const limit = 1400;
    if (compact.length <= limit) {
        return compact;
    }
    return `${compact.slice(0, limit)}\n... [truncated ${compact.length - limit} characters]`;
}

// Creates a short human-readable label for report rows when no description exists.
function describeStep(step) {
    if (step.type === "assertText") {
        return `body contains text "${step.text}"`;
    }
    if (step.type === "assertNoText") {
        return `body does not contain text "${step.text}"`;
    }
    if (step.selector) {
        return `${step.type} ${step.selector}`;
    }
    return step.type || "step";
}

// Enforces required plan fields close to the step that needs them.
function required(value, name) {
    if (value === undefined || value === null || String(value) === "") {
        throw new Error(`missing required ${name}`);
    }
    return String(value);
}

// Captures compact DOM evidence for the machine-readable result.
async function collectDomSnapshot(page) {
    return page.evaluate(() => {
        const cleanText = (value) => (value || "").replace(/\s+/g, " ").trim();
        const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
            .map((heading) => ({
                level: Number.parseInt(heading.tagName.slice(1), 10),
                text: cleanText(heading.textContent),
            }))
            .filter((heading) => heading.text)
            .slice(0, 40);
        const visibleButtons = Array.from(document.querySelectorAll("button,[role=\"button\"]"))
            .map((button) => cleanText(button.textContent) || button.getAttribute("aria-label") || "")
            .filter(Boolean)
            .slice(0, 60);
        return {
            url: window.location.href,
            title: document.title || "",
            lang: document.documentElement.lang || "",
            bodyTextSample: cleanText(document.body?.innerText || "").slice(0, 5000),
            counts: {
                links: document.querySelectorAll("a[href]").length,
                buttons: document.querySelectorAll("button,[role=\"button\"]").length,
                images: document.querySelectorAll("img").length,
                forms: document.querySelectorAll("form").length,
            },
            headings,
            visibleButtons,
        };
    });
}

// Runs Playwright, performs the planned actions/assertions, and writes evidence files.
export async function runAcceptance(options, identity, outputDir) {
    const evidence = {
        console: [],
        pageErrors: [],
        requestFailures: [],
        httpErrors: [],
    };
    const localTarget = isLocalEaselectUrl(options.target);
    const authStatePath = options.useAuthState && localTarget && fs.existsSync(options.authState)
        ? options.authState
        : undefined;
    const browser = await chromium.launch({
        headless: !options.headed,
        args: [`--window-size=${options.viewport.width},${options.viewport.height}`],
    });
    let context;
    let page;
    const steps = [];
    let auth = { status: "not_applicable" };
    let navigation = null;
    let domSnapshot = null;
    const startedAt = new Date().toISOString();

    try {
        context = await browser.newContext({
            viewport: { width: options.viewport.width, height: options.viewport.height },
            storageState: authStatePath,
            ignoreHTTPSErrors: true,
            extraHTTPHeaders: localTarget ? { "X-Bypass-Ratelimit": "test-mode" } : {},
        });
        page = await context.newPage();
        page.setDefaultTimeout(options.timeoutMs);
        installEvidenceListeners(page, evidence);

        if (localTarget && options.ensureLogin) {
            try {
                auth = await ensureLocalAuthenticated(page, context, options);
            } catch (error) {
                auth = {
                    status: "login_failed",
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }

        if (auth.status !== "login_failed") {
            navigation = await page.goto(options.target, { waitUntil: "domcontentloaded", timeout: 60000 });
            await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(options.settleMs);
            for (let index = 0; index < options.steps.length; index += 1) {
                steps.push(await executeStep(page, options.steps[index], options, outputDir, index + 1));
            }
            domSnapshot = await collectDomSnapshot(page);
        }

        const finalScreenshotPath = page
            ? path.join(outputDir, `screenshot-final-${options.viewport.name}.png`)
            : null;
        if (page && finalScreenshotPath) {
            await page.screenshot({ path: finalScreenshotPath, fullPage: true });
        }

        const result = buildResult({
            options,
            identity,
            outputDir,
            startedAt,
            finishedAt: new Date().toISOString(),
            auth,
            navigation,
            finalUrl: page ? page.url() : options.target,
            finalScreenshotPath,
            domSnapshot,
            evidence,
            steps,
        });
        writeArtifacts(result, evidence, domSnapshot, outputDir);
        return result;
    } finally {
        await browser.close();
    }
}

// Decides whether evidence passes, fails, or still needs human browser testing.
function decideVerdict({ options, auth, navigation, finalUrl, evidence, steps }) {
    const failures = [];
    const inconclusive = [];
    const automatedAssertions = steps.filter((step) => step.assertion).length;

    if (auth.status === "login_failed") {
        inconclusive.push(`local login failed: ${auth.error || "unknown error"}`);
    }
    if (!navigation && auth.status !== "login_failed") {
        failures.push("navigation did not return a browser response");
    }
    if (navigation && navigation.status() >= 400) {
        failures.push(`target navigation returned HTTP ${navigation.status()}`);
    }
    for (const step of steps) {
        if (step.status === "fail") {
            failures.push(`step ${step.index} failed: ${step.error}`);
        } else if (step.status === "inconclusive") {
            inconclusive.push(`step ${step.index} inconclusive: ${step.error}`);
        }
    }
    if (options.failOnConsoleError) {
        const consoleErrors = evidence.console.filter((item) => item.type === "error").length + evidence.pageErrors.length;
        if (consoleErrors > 0) {
            failures.push(`${consoleErrors} console/page error(s) captured`);
        }
    }
    if (options.failOnRequestFailure) {
        const serverErrors = evidence.httpErrors.filter((item) => item.status >= 500).length;
        const requestFailures = evidence.requestFailures.length + serverErrors;
        if (requestFailures > 0) {
            failures.push(`${requestFailures} request failure/server error(s) captured`);
        }
    }
    if (isLocalEaselectUrl(options.target) && options.ensureLogin && /login-entry=1|\/login\b/.test(finalUrl || "")) {
        inconclusive.push(`final URL still looks like login flow: ${finalUrl}`);
    }
    if (automatedAssertions === 0) {
        inconclusive.push("no automated assertions were provided");
    }

    if (failures.length > 0) {
        return { verdict: "fail", failures, inconclusive, automatedAssertions };
    }
    if (inconclusive.length > 0) {
        return { verdict: "inconclusive", failures, inconclusive, automatedAssertions };
    }
    return { verdict: "pass", failures, inconclusive, automatedAssertions };
}

// Builds the machine-readable result object written by every run.
function buildResult(details) {
    const { options, identity, outputDir, auth, navigation, finalUrl, finalScreenshotPath, domSnapshot, evidence, steps } = details;
    const decision = decideVerdict({ options, auth, navigation, finalUrl, evidence, steps });
    const replacement = replacementSummary(decision.verdict, decision.automatedAssertions, decision.inconclusive);
    const reportPath = path.join(outputDir, "ai_acceptance_report.md");
    const resultPath = path.join(outputDir, "ai_acceptance_result.json");
    return {
        tool: "human_qa ai-test",
        verdict: decision.verdict,
        replacement,
        ticketId: options.ticketId,
        target: options.target,
        finalUrl,
        profile: options.profile,
        viewport: options.viewport,
        createdAt: details.startedAt,
        finishedAt: details.finishedAt,
        cache: {
            fingerprint: identity.fingerprint,
            head: identity.head,
            diffHash: identity.diffHash,
            planHash: identity.planHash,
        },
        auth,
        navigation: navigation ? {
            status: navigation.status(),
            url: navigation.url(),
        } : null,
        checks: options.checks,
        steps,
        counts: {
            narrativeChecks: options.checks.length,
            steps: steps.length,
            automatedAssertions: decision.automatedAssertions,
            passedSteps: steps.filter((step) => step.status === "pass").length,
            failedSteps: steps.filter((step) => step.status === "fail").length,
            inconclusiveSteps: steps.filter((step) => step.status === "inconclusive").length,
            consoleErrors: evidence.console.filter((item) => item.type === "error").length,
            pageErrors: evidence.pageErrors.length,
            requestFailures: evidence.requestFailures.length,
            httpErrors: evidence.httpErrors.length,
        },
        failures: decision.failures,
        inconclusiveReasons: decision.inconclusive,
        artifacts: {
            result: relativePath(resultPath),
            report: relativePath(reportPath),
            screenshot: finalScreenshotPath ? relativePath(finalScreenshotPath) : null,
            console: relativePath(path.join(outputDir, "console.json")),
            network: relativePath(path.join(outputDir, "network.json")),
            domSnapshot: domSnapshot ? relativePath(path.join(outputDir, "dom_snapshot.json")) : null,
        },
    };
}

// Explains how a verdict should be used in the ticket acceptance workflow.
function replacementSummary(verdict, automatedAssertions, inconclusiveReasons) {
    if (verdict === "pass") {
        return {
            browserTesting: "replaces_human_browser_acceptance_for_covered_checks",
            closureGovernance: "human_or_project_rules_still_control_ticket_closure",
            reason: `${automatedAssertions} automated assertion(s) passed with browser evidence.`,
        };
    }
    if (verdict === "fail") {
        return {
            browserTesting: "replaces_human_browser_acceptance_with_rejection_evidence",
            closureGovernance: "fix_or_human_decision_required_before_closure",
            reason: "Automated browser acceptance found a concrete failure.",
        };
    }
    return {
        browserTesting: "human_browser_acceptance_still_required",
        closureGovernance: "human_or_project_rules_still_control_ticket_closure",
        reason: inconclusiveReasons[0] || "AI could not produce decisive browser acceptance evidence.",
    };
}

// Writes JSON evidence plus the markdown report next to screenshots.
function writeArtifacts(result, evidence, domSnapshot, outputDir) {
    fs.writeFileSync(path.join(outputDir, "console.json"), JSON.stringify({
        console: evidence.console,
        pageErrors: evidence.pageErrors,
    }, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(outputDir, "network.json"), JSON.stringify({
        requestFailures: evidence.requestFailures,
        httpErrors: evidence.httpErrors,
    }, null, 2) + "\n", "utf8");
    if (domSnapshot) {
        fs.writeFileSync(path.join(outputDir, "dom_snapshot.json"), JSON.stringify(domSnapshot, null, 2) + "\n", "utf8");
    }
    fs.writeFileSync(path.join(outputDir, "ai_acceptance_result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(outputDir, "ai_acceptance_report.md"), renderMarkdownReport(result), "utf8");
}

// Renders the human-readable evidence report used by close prep and chat summaries.
function renderMarkdownReport(result) {
    const lines = [
        `# AI Acceptance Report - ${result.verdict.toUpperCase()}`,
        "",
        "This report is browser acceptance evidence. It does not close the ticket or override final human/project governance.",
        "",
        "## Verdict",
        "",
        `- **Verdict**: ${result.verdict}`,
        `- **Browser testing replacement**: ${result.replacement.browserTesting}`,
        `- **Closure governance**: ${result.replacement.closureGovernance}`,
        `- **Reason**: ${result.replacement.reason}`,
        "",
        "## Target",
        "",
        `- **Ticket**: ${result.ticketId ? `#${result.ticketId}` : "(none)"}`,
        `- **Target**: ${result.target}`,
        `- **Final URL**: ${result.finalUrl}`,
        `- **Profile**: ${result.profile}`,
        `- **Viewport**: ${result.viewport.name} (${result.viewport.width}x${result.viewport.height})`,
        "",
        "## Cache Identity",
        "",
        `- **Fingerprint**: ${result.cache.fingerprint}`,
        `- **HEAD**: ${result.cache.head}`,
        `- **Diff hash**: ${result.cache.diffHash}`,
        `- **Plan hash**: ${result.cache.planHash}`,
        "",
        "## Acceptance Scope",
        "",
    ];
    if (result.checks.length) {
        lines.push(...result.checks.map((check) => `- ${check}`));
    } else {
        lines.push("- No narrative checklist items were provided.");
    }
    lines.push(
        "",
        "Narrative checklist items provide scope. The machine verdict is based on automated actions/assertions below.",
        "",
        "## Automated Steps",
        "",
    );
    if (result.steps.length) {
        for (const step of result.steps) {
            const suffix = step.error ? ` - ${step.error}` : "";
            lines.push(`- **${step.status}** step ${step.index}: ${step.description}${suffix}`);
        }
    } else {
        lines.push("- No automated steps were provided.");
    }
    if (result.failures.length) {
        lines.push("", "## Failures", "", ...result.failures.map((item) => `- ${item}`));
    }
    if (result.inconclusiveReasons.length) {
        lines.push("", "## Inconclusive Reasons", "", ...result.inconclusiveReasons.map((item) => `- ${item}`));
    }
    lines.push(
        "",
        "## Evidence Artifacts",
        "",
        `- **Result JSON**: ${result.artifacts.result}`,
        `- **Screenshot**: ${result.artifacts.screenshot || "(not captured)"}`,
        `- **Console**: ${result.artifacts.console}`,
        `- **Network**: ${result.artifacts.network}`,
        `- **DOM snapshot**: ${result.artifacts.domSnapshot || "(not captured)"}`,
        "",
        "## Evidence Counts",
        "",
        `- **Automated assertions**: ${result.counts.automatedAssertions}`,
        `- **Passed steps**: ${result.counts.passedSteps}`,
        `- **Failed steps**: ${result.counts.failedSteps}`,
        `- **Inconclusive steps**: ${result.counts.inconclusiveSteps}`,
        `- **Console errors**: ${result.counts.consoleErrors}`,
        `- **Page errors**: ${result.counts.pageErrors}`,
        `- **Request failures**: ${result.counts.requestFailures}`,
        `- **HTTP errors**: ${result.counts.httpErrors}`,
        "",
    );
    return `${lines.join("\n")}\n`;
}

// Displays repository-relative paths in artifacts while keeping absolute paths valid.
function relativePath(value) {
    if (!value) {
        return value;
    }
    const relative = path.relative(repoRoot, value);
    return relative.startsWith("..") ? value : relative;
}
