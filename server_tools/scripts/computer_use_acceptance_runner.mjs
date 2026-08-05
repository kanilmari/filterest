// computer_use_acceptance_runner.mjs - Computer Use acceptance execution core.
// Bridges Playwright browser control, OpenAI Responses computer tool actions, and evidence.
// Runs a guarded browser session and returns result data for the CLI wrapper.
// Exists to keep the Computer Use action loop reusable and below file limits.
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { renderComputerUseReport } from "./computer_use_acceptance_reporter.mjs";
import { isLocalEaselectUrl } from "./local_easelect_target.mjs";

const defaultAllowedHosts = ["localhost:8082", "127.0.0.1:8082", "[::1]:8082"];

// Runs the browser and optional Computer Use API loop.
export async function runComputerUseAcceptance(options, outputDir, repoRoot) {
    const evidence = { console: [], pageErrors: [], blockedRequests: [], actions: [], responses: [] };
    const browser = await chromium.launch({
        headless: !options.headed,
        args: [`--window-size=${options.viewport.width},${options.viewport.height}`],
    });
    const startedAt = new Date().toISOString();
    try {
        const session = await openBrowserSession(browser, options, evidence, repoRoot);
        const initialScreenshot = await captureScreenshot(session.page, outputDir, "initial");
        const modelOutcome = options.dryRun
            ? dryRunOutcome()
            : await runOpenAIComputerLoop(session.page, options, outputDir, evidence, initialScreenshot);
        const finalScreenshot = await captureScreenshot(session.page, outputDir, "final");
        const result = buildResult({
            options,
            outputDir,
            auth: session.auth,
            evidence,
            modelOutcome,
            finalScreenshot,
            startedAt,
            finalUrl: session.page.url(),
            repoRoot,
        });
        writeArtifacts(result, evidence, outputDir);
        return result;
    } finally {
        await browser.close();
    }
}

// Opens a guarded Playwright context and navigates to the target.
async function openBrowserSession(browser, options, evidence, repoRoot) {
    const localTarget = isLocalEaselectUrl(options.target);
    const authStatePath = options.useAuthState && localTarget && fs.existsSync(options.authState) ? options.authState : undefined;
    const context = await browser.newContext({
        viewport: { width: options.viewport.width, height: options.viewport.height },
        storageState: authStatePath,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: localTarget ? { "X-Bypass-Ratelimit": "test-mode" } : {},
    });
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    await installBrowserGuards(context, page, options, evidence);
    let auth = { status: "not_applicable" };
    if (localTarget && options.ensureLogin) {
        auth = await ensureLocalAuthenticated(page, context, options, repoRoot);
    }
    await page.goto(options.target, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(options.settleMs);
    return { context, page, auth };
}

// Reuses or refreshes local auth state before Computer Use starts.
async function ensureLocalAuthenticated(page, context, options, repoRoot) {
    const credentials = loadTestCredentials(repoRoot);
    await page.goto(new URL("/", options.target).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(500);
    const existingProfile = await readUserProfile(page);
    if (isAuthenticatedProfile(existingProfile, credentials.username)) {
        return { status: "authenticated", refreshed: false, username: existingProfile.username || credentials.username };
    }
    await performLocalLogin(page, context, options, credentials);
    const profile = await readUserProfile(page);
    return { status: "authenticated", refreshed: true, username: profile.username || credentials.username };
}

// Reads test-admin credentials from the repo-local development credential file.
function loadTestCredentials(repoRoot) {
    const raw = fs.readFileSync(path.join(repoRoot, "dev_env_test_creds.txt"), "utf8");
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
        if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) {
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

// Performs the local test-admin login flow and stores refreshed auth state.
async function performLocalLogin(page, context, options, credentials) {
    const loginUrl = new URL("/", options.target);
    loginUrl.searchParams.set("login-entry", "1");
    loginUrl.searchParams.set("redirect", targetRedirectPath(options.target));
    await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('[data-testid="login-form"]').waitFor({ state: "visible", timeout: 15000 });
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
    await page.waitForSelector('[data-testid^="tab-"]', { timeout: 15000 });
    if (options.useAuthState && options.authState) {
        fs.mkdirSync(path.dirname(options.authState), { recursive: true });
        await context.storageState({ path: options.authState });
    }
}

// Builds the redirect path used by the local login modal entry point.
function targetRedirectPath(target) {
    const parsed = new URL(target);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

// Installs network/domain guardrails and evidence listeners.
async function installBrowserGuards(context, page, options, evidence) {
    await context.route("**/*", async (route) => {
        const request = route.request();
        if (isAllowedRequestUrl(request.url(), options)) {
            await route.continue();
            return;
        }
        evidence.blockedRequests.push({
            method: request.method(),
            url: request.url(),
            resourceType: request.resourceType(),
            timestamp: new Date().toISOString(),
        });
        await route.abort("blockedbyclient");
    });
    page.on("console", (message) => {
        evidence.console.push({ type: message.type(), text: message.text(), timestamp: new Date().toISOString() });
    });
    page.on("pageerror", (error) => {
        evidence.pageErrors.push({ message: error.message, stack: error.stack || "", timestamp: new Date().toISOString() });
    });
}

// Allows only trusted local/file/browser-internal resources by default.
function isAllowedRequestUrl(rawUrl, options) {
    try {
        const parsed = new URL(rawUrl);
        if (["data:", "blob:", "about:"].includes(parsed.protocol)) {
            return true;
        }
        if (parsed.protocol === "file:") {
            return options.targetSource === "file";
        }
        if (!["http:", "https:"].includes(parsed.protocol)) {
            return false;
        }
        return (options.allowedHosts || defaultAllowedHosts).includes(parsed.host);
    } catch (_error) {
        return false;
    }
}

// Captures a viewport screenshot as a data URL for the Responses API.
async function captureScreenshot(page, outputDir, label) {
    const screenshotPath = path.join(outputDir, `computer-use-${slugify(label)}.png`);
    const buffer = await page.screenshot({ path: screenshotPath, fullPage: false });
    return {
        path: screenshotPath,
        imageUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    };
}

// Turns labels into safe path segments.
function slugify(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item";
}

// Returns the dry-run evidence result without calling OpenAI.
function dryRunOutcome() {
    return {
        stoppedReason: "dry_run",
        finalText: "",
        decision: {
            verdict: "inconclusive",
            summary: "Dry run opened the target and captured screenshots without calling OpenAI.",
            coveredChecks: [],
            findings: [],
            nextRecommendedMode: "computer-use",
        },
    };
}

// Runs the OpenAI Computer Use Responses loop.
async function runOpenAIComputerLoop(page, options, outputDir, evidence, initialScreenshot) {
    const prompt = buildPrompt(options);
    let response = await createResponse(responsePayload(options, [{
        role: "user",
        content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: initialScreenshot.imageUrl, detail: "high" },
        ],
    }]), options);
    for (let step = 1; step <= options.maxSteps; step += 1) {
        evidence.responses.push(redactResponse(response));
        const call = firstComputerCall(response);
        if (!call) {
            const finalText = outputText(response);
            return { stoppedReason: "model_finished", finalText, decision: parseModelDecision(finalText) };
        }
        if ((call.pending_safety_checks || []).length && !options.allowSafetyChecks) {
            const finalText = `Stopped for pending safety checks: ${JSON.stringify(call.pending_safety_checks)}`;
            return { stoppedReason: "pending_safety_checks", finalText, decision: parseModelDecision(finalText) };
        }
        await executeComputerActions(page, computerActions(call), options);
        evidence.actions.push({ step, callId: call.call_id, actions: computerActions(call), urlAfterAction: page.url() });
        if (!isAllowedCurrentUrl(page.url(), options)) {
            const finalText = `Stopped after navigation outside allowed target: ${page.url()}`;
            return { stoppedReason: "blocked_navigation", finalText, decision: parseModelDecision(finalText) };
        }
        const screenshot = await captureScreenshot(page, outputDir, `step-${step}`);
        response = await createResponse(responsePayload(options, [{
            type: "computer_call_output",
            call_id: call.call_id,
            acknowledged_safety_checks: options.allowSafetyChecks ? (call.pending_safety_checks || []) : [],
            output: { type: "computer_screenshot", image_url: screenshot.imageUrl },
        }], response.id), options);
    }
    const finalText = "Computer Use reached the max step limit before returning a final verdict.";
    return { stoppedReason: "max_steps", finalText, decision: parseModelDecision(finalText) };
}

// Builds the prompt profile that makes Computer Use produce structured evidence.
function buildPrompt(options) {
    const profileGuidance = {
        acceptance: "Test the listed acceptance criteria. Prefer concrete pass/fail evidence over broad commentary.",
        "ux-audit": "Explore the target like a careful user. Report UX friction, confusing states, missing affordances, and suggested follow-up tickets.",
        "release-readiness": "Review the target for public release readiness. Identify blockers, unclear wording, missing checklist evidence, and launch-risk items.",
        "regression-scout": "Look for obvious regressions caused by the latest change. Focus on broken navigation, missing UI, duplicated content, and console-visible symptoms.",
    }[options.promptProfile] || "Test the target and produce concise acceptance evidence.";
    const checks = options.checks.length ? options.checks.map((item) => `- ${item}`).join("\n") : "- No explicit checks were supplied.";
    const goals = options.goals.length ? options.goals.map((item) => `- ${item}`).join("\n") : "- Stay inside the provided target and allowed local domain.";
    return [
        "You are Easelect's live Computer Use acceptance tester.",
        profileGuidance,
        "Use the browser visually like a human tester, but do not close tickets, approve releases, create records, delete records, change settings, or leave the allowed target.",
        "The runner controls the page viewport, not the browser chrome. Do not use the address bar or keyboard shortcuts such as Ctrl+L/Alt+D to visit another URL; ask for a separate run if another target must be tested.",
        "Only report evidence from the current page URL and in-page navigation that actually appears in the screenshot.",
        "If a check requires a destructive or high-stakes action, stop and return inconclusive.",
        "",
        `Target: ${options.target}`,
        `Ticket: ${options.ticketId || "(none)"}`,
        `Prompt profile: ${options.promptProfile}`,
        "",
        "Acceptance checks:",
        checks,
        "",
        "Additional goals:",
        goals,
        "",
        "When finished, respond with raw JSON only:",
        "{\"verdict\":\"pass|fail|inconclusive\",\"summary\":\"one short paragraph\",\"coveredChecks\":[\"...\"],\"findings\":[{\"severity\":\"P1|P2|P3\",\"title\":\"...\",\"evidence\":\"...\",\"suggestedTicket\":\"...\"}],\"nextRecommendedMode\":\"structured|computer-use|human\"}",
    ].join("\n");
}

// Calls OpenAI Responses API without adding an SDK dependency.
async function createResponse(payload, options) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("missing OPENAI_API_KEY in the resolved native environment; use --dry-run to verify local wiring without an API call");
    }
    const controller = new AbortController();
    const timeoutMs = options?.apiTimeoutMs || 120000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
        response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error(`OpenAI Responses API timed out after ${timeoutMs}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
    const bodyText = await response.text();
    let body = {};
    try {
        body = JSON.parse(bodyText);
    } catch (_error) {
        body = { raw: bodyText };
    }
    if (!response.ok) {
        throw new Error(`OpenAI Responses API returned HTTP ${response.status}: ${body.error?.message || bodyText.slice(0, 500)}`);
    }
    return body;
}

// Builds the common Responses API request body for the GA computer tool.
function responsePayload(options, input, previousResponseId = null) {
    const payload = {
        model: options.model,
        tools: [{ type: "computer" }],
        input,
        reasoning: { summary: "concise" },
        truncation: "auto",
    };
    if (previousResponseId) {
        payload.previous_response_id = previousResponseId;
    }
    return payload;
}

// Extracts the next Computer Use action call from a Responses API response.
function firstComputerCall(response) {
    return (response.output || []).find((item) => item.type === "computer_call") || null;
}

// Returns the current GA actions array, with legacy single-action compatibility.
function computerActions(call) {
    if (Array.isArray(call.actions)) {
        return call.actions;
    }
    return call.action ? [call.action] : [];
}

// Extracts final assistant text from a Responses API response.
function outputText(response) {
    const chunks = [];
    for (const item of response.output || []) {
        if (item.type === "message") {
            for (const part of item.content || []) {
                if (part.type === "output_text" || part.type === "text") {
                    chunks.push(part.text || "");
                }
            }
        }
        if (typeof item.output_text === "string") {
            chunks.push(item.output_text);
        }
    }
    return chunks.join("\n").trim() || response.output_text || "";
}

// Executes OpenAI computer actions in Playwright.
async function executeComputerActions(page, actions, options) {
    for (const action of actions) {
        await executeComputerAction(page, action, options);
    }
}

// Executes one OpenAI computer action in Playwright.
async function executeComputerAction(page, action, options) {
    const type = action?.type || "unknown";
    if (type === "click") {
        await page.mouse.click(action.x, action.y, { button: normalizeButton(action.button) });
    } else if (type === "double_click") {
        await page.mouse.dblclick(action.x, action.y, { button: normalizeButton(action.button) });
    } else if (type === "move" || type === "mouse_move") {
        await page.mouse.move(action.x, action.y);
    } else if (type === "scroll") {
        await page.mouse.move(action.x || 0, action.y || 0);
        await page.mouse.wheel(action.scroll_x || action.delta_x || 0, action.scroll_y || action.delta_y || 0);
    } else if (type === "keypress") {
        for (const keypress of keypressSequences(action.keys || [])) {
            await page.keyboard.press(keypress);
        }
    } else if (type === "type") {
        await page.keyboard.type(String(action.text || ""));
    } else if (type === "wait" || type === "screenshot") {
        await page.waitForTimeout(type === "wait" ? 2000 : 250);
    } else {
        throw new Error(`unsupported computer action: ${type}`);
    }
    await page.waitForTimeout(options.settleMs);
}

const modifierKeys = new Set(["Control", "Shift", "Alt", "Meta"]);

// Converts CUA key arrays into Playwright press strings, preserving modifier chords.
export function keypressSequences(keys) {
    const normalized = (keys || []).map(normalizeKey).filter(Boolean);
    const modifiers = normalized.filter((key) => modifierKeys.has(key));
    const ordinaryKeys = normalized.filter((key) => !modifierKeys.has(key));
    if (modifiers.length === 0 || ordinaryKeys.length === 0) {
        return normalized;
    }
    return ordinaryKeys.map((key) => [...modifiers, key].join("+"));
}

// Normalizes OpenAI mouse button names for Playwright.
function normalizeButton(button) {
    return ["left", "right", "middle"].includes(button) ? button : "left";
}

// Normalizes common CUA key names for Playwright.
export function normalizeKey(key) {
    const lower = String(key || "").toLowerCase();
    if (lower === "ctrl" || lower === "control") {
        return "Control";
    }
    if (lower === "shift") {
        return "Shift";
    }
    if (lower === "alt" || lower === "option") {
        return "Alt";
    }
    if (lower === "meta" || lower === "cmd" || lower === "command" || lower === "win" || lower === "super") {
        return "Meta";
    }
    if (lower === "backspace" || lower === "delete" || lower === "tab") {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
    if (lower === "enter") {
        return "Enter";
    }
    if (lower === "space") {
        return " ";
    }
    if (lower === "esc" || lower === "escape") {
        return "Escape";
    }
    const navigationKeys = {
        home: "Home",
        end: "End",
        pageup: "PageUp",
        "page-up": "PageUp",
        page_up: "PageUp",
        pagedown: "PageDown",
        "page-down": "PageDown",
        page_down: "PageDown",
        arrowup: "ArrowUp",
        "arrow-up": "ArrowUp",
        arrow_up: "ArrowUp",
        up: "ArrowUp",
        arrowdown: "ArrowDown",
        "arrow-down": "ArrowDown",
        arrow_down: "ArrowDown",
        down: "ArrowDown",
        arrowleft: "ArrowLeft",
        "arrow-left": "ArrowLeft",
        arrow_left: "ArrowLeft",
        left: "ArrowLeft",
        arrowright: "ArrowRight",
        "arrow-right": "ArrowRight",
        arrow_right: "ArrowRight",
        right: "ArrowRight",
    };
    if (navigationKeys[lower]) {
        return navigationKeys[lower];
    }
    return String(key || "");
}

// Checks post-action navigation against allowed local/file scope.
function isAllowedCurrentUrl(rawUrl, options) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === "file:") {
            return options.targetSource === "file";
        }
        return ["http:", "https:"].includes(parsed.protocol) && (options.allowedHosts || defaultAllowedHosts).includes(parsed.host);
    } catch (_error) {
        return false;
    }
}

// Parses the final model JSON; uncertain text becomes inconclusive evidence.
function parseModelDecision(text) {
    const raw = extractJsonObject(text);
    if (!raw) {
        return { verdict: "inconclusive", summary: text || "Computer Use did not return a parseable JSON verdict.", coveredChecks: [], findings: [], nextRecommendedMode: "human" };
    }
    try {
        const parsed = JSON.parse(raw);
        const verdict = ["pass", "fail", "inconclusive"].includes(parsed.verdict) ? parsed.verdict : "inconclusive";
        return {
            verdict,
            summary: String(parsed.summary || ""),
            coveredChecks: Array.isArray(parsed.coveredChecks) ? parsed.coveredChecks.map(String) : [],
            findings: Array.isArray(parsed.findings) ? parsed.findings : [],
            nextRecommendedMode: parsed.nextRecommendedMode || "human",
        };
    } catch (_error) {
        return { verdict: "inconclusive", summary: text || "Computer Use returned invalid JSON.", coveredChecks: [], findings: [], nextRecommendedMode: "human" };
    }
}

// Extracts the first likely JSON object from raw assistant text.
function extractJsonObject(text) {
    const trimmed = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        return trimmed;
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    return start >= 0 && end > start ? trimmed.slice(start, end + 1) : "";
}

// Removes image data and volatile bulk from API responses before writing logs.
function redactResponse(response) {
    return {
        id: response.id,
        status: response.status,
        output: (response.output || []).map((item) => ({
            type: item.type,
            id: item.id,
            call_id: item.call_id,
            actions: item.actions,
            action: item.action,
            pending_safety_checks: item.pending_safety_checks || [],
            text: item.type === "message" ? outputText({ output: [item] }).slice(0, 4000) : undefined,
        })),
    };
}

// Builds the machine-readable result object.
function buildResult(details) {
    const { options, outputDir, auth, evidence, modelOutcome, finalScreenshot, startedAt, finalUrl, repoRoot } = details;
    const forcedInconclusive = modelOutcome.stoppedReason && !["model_finished", "dry_run"].includes(modelOutcome.stoppedReason);
    const verdict = forcedInconclusive ? "inconclusive" : modelOutcome.decision.verdict;
    return {
        tool: "human_qa computer-use-test",
        verdict,
        replacement: replacementSummary(verdict, modelOutcome.stoppedReason, options.dryRun),
        ticketId: options.ticketId,
        target: options.target,
        finalUrl,
        profile: options.promptProfile,
        model: options.model,
        viewport: options.viewport,
        createdAt: startedAt,
        finishedAt: new Date().toISOString(),
        dryRun: options.dryRun,
        stoppedReason: modelOutcome.stoppedReason,
        auth,
        checks: options.checks,
        goals: options.goals,
        modelDecision: modelOutcome.decision,
        rawFinalText: modelOutcome.finalText,
        counts: evidenceCounts(evidence, modelOutcome.decision),
        artifacts: artifactPaths(outputDir, finalScreenshot, repoRoot),
    };
}

// Explains how a Computer Use verdict should be used by close prep.
function replacementSummary(verdict, stoppedReason, dryRun) {
    if (dryRun) {
        return { browserTesting: "not_replacement_dry_run", closureGovernance: "human_or_project_rules_still_control_ticket_closure", reason: "Dry run validated local wiring but did not call the Computer Use model." };
    }
    if (verdict === "pass") {
        return { browserTesting: "can_replace_human_browser_acceptance_for_observed_scope", closureGovernance: "human_or_project_rules_still_control_ticket_closure", reason: "Computer Use completed a live visual browser acceptance pass." };
    }
    if (verdict === "fail") {
        return { browserTesting: "replaces_human_browser_acceptance_with_failure_evidence", closureGovernance: "fix_or_human_decision_required_before_closure", reason: "Computer Use found a concrete browser/UI failure." };
    }
    return { browserTesting: "human_or_structured_acceptance_still_required", closureGovernance: "human_or_project_rules_still_control_ticket_closure", reason: stoppedReason || "Computer Use could not produce decisive acceptance evidence." };
}

// Computes compact evidence counts.
function evidenceCounts(evidence, decision) {
    return {
        actions: evidence.actions.length,
        blockedRequests: evidence.blockedRequests.length,
        consoleErrors: evidence.console.filter((item) => item.type === "error").length,
        pageErrors: evidence.pageErrors.length,
        findings: decision.findings.length,
    };
}

// Returns artifact paths relative to the repository.
function artifactPaths(outputDir, finalScreenshot, repoRoot) {
    return {
        result: relativePath(path.join(outputDir, "computer_use_result.json"), repoRoot),
        report: relativePath(path.join(outputDir, "computer_use_report.md"), repoRoot),
        screenshot: relativePath(finalScreenshot.path, repoRoot),
        actions: relativePath(path.join(outputDir, "computer_use_actions.json"), repoRoot),
        responses: relativePath(path.join(outputDir, "computer_use_responses.json"), repoRoot),
        browserEvidence: relativePath(path.join(outputDir, "browser_evidence.json"), repoRoot),
    };
}

// Writes JSON evidence plus markdown report.
function writeArtifacts(result, evidence, outputDir) {
    fs.writeFileSync(path.join(outputDir, "computer_use_result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(outputDir, "computer_use_actions.json"), JSON.stringify(evidence.actions, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(outputDir, "computer_use_responses.json"), JSON.stringify(evidence.responses, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(outputDir, "browser_evidence.json"), JSON.stringify({
        console: evidence.console,
        pageErrors: evidence.pageErrors,
        blockedRequests: evidence.blockedRequests,
    }, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(outputDir, "computer_use_report.md"), renderComputerUseReport(result), "utf8");
}

// Displays repository-relative paths while keeping external paths valid.
function relativePath(value, repoRoot) {
    const relative = path.relative(repoRoot, value);
    return relative.startsWith("..") ? value : relative;
}
