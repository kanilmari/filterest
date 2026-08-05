// ai_acceptance_test.mjs - AI acceptance CLI for ticket browser QA.
// Bridges ticket IDs, target/checklist parsing, cache identity, and Playwright runner output.
// Produces machine-readable pass/fail/inconclusive evidence for close-prep review.
// Exists so AI can replace human browser acceptance testing when checks are automatable.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { runAcceptance } from "./ai_acceptance_runner.mjs";
import { authStatePathForTarget } from "./local_easelect_target.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const defaultAuthState = path.join(repoRoot, "testing/e2e/.auth/user.json");
const defaultArtifactRoot = path.join(repoRoot, "agent_tasks/_artifacts/human_qa/ai_acceptance");
const defaultViewport = { width: 1440, height: 900, name: "desktop" };

// Shows the command contract for direct script use and Filterest dispatch.
function usage() {
    return `Usage:
  ./filterest audit human ai-test <ticket-id> --url <URL|route> [options]
  ./filterest audit human ai-test <ticket-id> --file <path> [options]

Options:
  --url <URL|route>          Browser target. Routes like /service_catalog use https://localhost:8082.
  --file <path>              File target to open in the browser.
  --plan-file <path>         JSON plan with steps/checks; repeatable.
  --check <text>             Narrative acceptance checklist item; repeatable.
  --assert-text <text>       Pass when visible page/body text contains text; repeatable.
  --assert-no-text <text>    Pass when page/body text does not contain text; repeatable.
  --assert-visible <selector>      Pass when selector is visible; repeatable.
  --assert-hidden <selector>       Pass when selector is hidden or absent; repeatable.
  --assert-url-contains <text>     Pass when the final URL contains text.
  --assert-url-matches <regex>     Pass when the final URL matches regex.
  --click <selector>         Click selector before assertions; repeatable.
  --fill <selector> <value>  Fill selector with value before assertions; repeatable.
  --press <selector> <key>   Press key on selector before assertions; repeatable.
  --wait-for <selector>      Wait for selector to become visible; repeatable.
  --screenshot <name>        Capture an extra named screenshot step; repeatable.
  --profile <name>           Fingerprint label for scenario/profile. Default: default.
  --viewport <WxH|desktop|mobile|tablet>
  --auth-state <path>        Playwright storageState JSON. Default: per-target under testing/e2e/.auth/.
  --no-auth-state            Do not reuse auth state.
  --no-ensure-login          Do not verify/refresh local Easelect login before testing.
  --headed                   Show Chromium while running the AI acceptance pass.
  --output-dir <path>        Artifact directory. Defaults to ticket + fingerprint cache path.
  --force                    Re-run even when matching evidence already exists.
  --fail-on-console-error    Treat browser console errors/page errors as test failures.
  --fail-on-request-failure  Treat failed requests and HTTP 5xx responses as test failures.
  --settle-ms <ms>           Extra wait after navigation and each action. Default: 1000.
  --timeout-ms <ms>          Playwright operation timeout. Default: 30000.
  --help                     Show this help.

Verdicts:
  pass           At least one automated assertion ran and all automated checks passed.
  fail           A navigation, action, assertion, or requested evidence gate failed.
  inconclusive   The browser ran, but the evidence cannot replace human browser testing.

Examples:
  ./filterest audit human ai-test 837 --url /service_catalog --check "Firefox logo appears once" --assert-visible "img[alt*=Firefox]" --assert-no-text "duplicate logo"
  ./filterest audit human ai-test 0 --file docs/instructions_and_documentation/Human_QA_Handoff.md --assert-text "Human QA And AI Acceptance"`;
}

// Parses CLI flags into a neutral plan before plan files are loaded.
function parseArgs(argv) {
    const args = [...argv];
    if (args[0] === "ai-test") {
        args.shift();
    }
    const options = {
        ticketId: null,
        target: null,
        targetSource: null,
        checks: [],
        steps: [],
        planFiles: [],
        profile: "default",
        viewport: defaultViewport,
        authState: defaultAuthState,
        authStateExplicit: false,
        useAuthState: true,
        ensureLogin: true,
        headed: false,
        outputDir: null,
        force: false,
        failOnConsoleError: false,
        failOnRequestFailure: false,
        settleMs: 1000,
        timeoutMs: 30000,
    };

    if (args[0] && !args[0].startsWith("-")) {
        options.ticketId = args.shift();
    }

    const take = (flag) => {
        if (args.length === 0) {
            throw new Error(`missing value for ${flag}`);
        }
        return args.shift();
    };

    while (args.length > 0) {
        const arg = args.shift();
        if (arg === "--help" || arg === "-h") {
            options.help = true;
        } else if (arg === "--url") {
            setTarget(options, take(arg), "url");
        } else if (arg.startsWith("--url=")) {
            setTarget(options, arg.slice("--url=".length), "url");
        } else if (arg === "--file") {
            setTarget(options, take(arg), "file");
        } else if (arg.startsWith("--file=")) {
            setTarget(options, arg.slice("--file=".length), "file");
        } else if (arg === "--plan-file") {
            options.planFiles.push(path.resolve(take(arg)));
        } else if (arg.startsWith("--plan-file=")) {
            options.planFiles.push(path.resolve(arg.slice("--plan-file=".length)));
        } else if (arg === "--check") {
            options.checks.push(take(arg));
        } else if (arg.startsWith("--check=")) {
            options.checks.push(arg.slice("--check=".length));
        } else if (arg === "--assert-text") {
            options.steps.push({ type: "assertText", text: take(arg), source: "cli" });
        } else if (arg.startsWith("--assert-text=")) {
            options.steps.push({ type: "assertText", text: arg.slice("--assert-text=".length), source: "cli" });
        } else if (arg === "--assert-no-text") {
            options.steps.push({ type: "assertNoText", text: take(arg), source: "cli" });
        } else if (arg.startsWith("--assert-no-text=")) {
            options.steps.push({ type: "assertNoText", text: arg.slice("--assert-no-text=".length), source: "cli" });
        } else if (arg === "--assert-visible") {
            options.steps.push({ type: "assertVisible", selector: take(arg), source: "cli" });
        } else if (arg.startsWith("--assert-visible=")) {
            options.steps.push({ type: "assertVisible", selector: arg.slice("--assert-visible=".length), source: "cli" });
        } else if (arg === "--assert-hidden") {
            options.steps.push({ type: "assertHidden", selector: take(arg), source: "cli" });
        } else if (arg.startsWith("--assert-hidden=")) {
            options.steps.push({ type: "assertHidden", selector: arg.slice("--assert-hidden=".length), source: "cli" });
        } else if (arg === "--assert-url-contains") {
            options.steps.push({ type: "assertUrlContains", text: take(arg), source: "cli" });
        } else if (arg.startsWith("--assert-url-contains=")) {
            options.steps.push({ type: "assertUrlContains", text: arg.slice("--assert-url-contains=".length), source: "cli" });
        } else if (arg === "--assert-url-matches") {
            options.steps.push({ type: "assertUrlMatches", pattern: take(arg), source: "cli" });
        } else if (arg.startsWith("--assert-url-matches=")) {
            options.steps.push({ type: "assertUrlMatches", pattern: arg.slice("--assert-url-matches=".length), source: "cli" });
        } else {
            parseActionOrOption(options, arg, take);
        }
    }

    return options;
}

// Handles action and runtime flags after assertion parsing.
function parseActionOrOption(options, arg, take) {
    if (arg === "--click") {
        options.steps.push({ type: "click", selector: take(arg), source: "cli" });
    } else if (arg.startsWith("--click=")) {
        options.steps.push({ type: "click", selector: arg.slice("--click=".length), source: "cli" });
    } else if (arg === "--fill") {
        options.steps.push({ type: "fill", selector: take(arg), value: take(arg), source: "cli" });
    } else if (arg === "--press") {
        options.steps.push({ type: "press", selector: take(arg), key: take(arg), source: "cli" });
    } else if (arg === "--wait-for") {
        options.steps.push({ type: "waitForSelector", selector: take(arg), state: "visible", source: "cli" });
    } else if (arg.startsWith("--wait-for=")) {
        options.steps.push({ type: "waitForSelector", selector: arg.slice("--wait-for=".length), state: "visible", source: "cli" });
    } else if (arg === "--screenshot") {
        options.steps.push({ type: "screenshot", name: take(arg), source: "cli" });
    } else if (arg.startsWith("--screenshot=")) {
        options.steps.push({ type: "screenshot", name: arg.slice("--screenshot=".length), source: "cli" });
    } else if (arg === "--profile") {
        options.profile = take(arg);
    } else if (arg.startsWith("--profile=")) {
        options.profile = arg.slice("--profile=".length);
    } else if (arg === "--viewport") {
        options.viewport = parseViewport(take(arg));
    } else if (arg.startsWith("--viewport=")) {
        options.viewport = parseViewport(arg.slice("--viewport=".length));
    } else if (arg === "--auth-state") {
        options.authState = path.resolve(take(arg));
        options.authStateExplicit = true;
    } else if (arg.startsWith("--auth-state=")) {
        options.authState = path.resolve(arg.slice("--auth-state=".length));
        options.authStateExplicit = true;
    } else if (arg === "--no-auth-state") {
        options.useAuthState = false;
    } else if (arg === "--no-ensure-login") {
        options.ensureLogin = false;
    } else if (arg === "--headed") {
        options.headed = true;
    } else if (arg === "--output-dir") {
        options.outputDir = path.resolve(take(arg));
    } else if (arg.startsWith("--output-dir=")) {
        options.outputDir = path.resolve(arg.slice("--output-dir=".length));
    } else if (arg === "--force") {
        options.force = true;
    } else if (arg === "--fail-on-console-error") {
        options.failOnConsoleError = true;
    } else if (arg === "--fail-on-request-failure") {
        options.failOnRequestFailure = true;
    } else if (arg === "--settle-ms") {
        options.settleMs = parseNonNegativeInt(take(arg), "--settle-ms");
    } else if (arg.startsWith("--settle-ms=")) {
        options.settleMs = parseNonNegativeInt(arg.slice("--settle-ms=".length), "--settle-ms");
    } else if (arg === "--timeout-ms") {
        options.timeoutMs = parsePositiveInt(take(arg), "--timeout-ms");
    } else if (arg.startsWith("--timeout-ms=")) {
        options.timeoutMs = parsePositiveInt(arg.slice("--timeout-ms=".length), "--timeout-ms");
    } else {
        throw new Error(`unknown argument: ${arg}`);
    }
}

// Stores the resolved browser target and its source mode.
function setTarget(options, rawValue, mode) {
    options.target = resolveTarget(rawValue, mode);
    options.targetSource = mode;
    if (!options.authStateExplicit) {
        options.authState = authStatePathForTarget(repoRoot, options.target, defaultAuthState);
    }
}

// Converts route/file shorthand into the browser URL Playwright should open.
function resolveTarget(rawValue, mode) {
    const value = String(rawValue || "").trim();
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

// Converts named or explicit viewport arguments into Playwright dimensions.
function parseViewport(value) {
    const named = {
        desktop: defaultViewport,
        tablet: { width: 1024, height: 768, name: "tablet" },
        mobile: { width: 390, height: 844, name: "mobile" },
    };
    if (named[value]) {
        return named[value];
    }
    const match = String(value).match(/^(\d{3,5})x(\d{3,5})$/i);
    if (!match) {
        throw new Error(`invalid viewport "${value}"`);
    }
    return {
        width: parsePositiveInt(match[1], "--viewport width"),
        height: parsePositiveInt(match[2], "--viewport height"),
        name: `${match[1]}x${match[2]}`,
    };
}

// Validates positive integer flags before browser timing uses them.
function parsePositiveInt(value, flagName) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${flagName} must be a positive integer`);
    }
    return parsed;
}

// Validates non-negative integer flags before browser timing uses them.
function parseNonNegativeInt(value, flagName) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${flagName} must be a non-negative integer`);
    }
    return parsed;
}

// Loads JSON plan files and merges their target, checklist, and steps.
function loadPlanFiles(options) {
    for (const planFile of options.planFiles) {
        const raw = fs.readFileSync(planFile, "utf8");
        const plan = JSON.parse(raw);
        if (!options.target) {
            if (plan.file) {
                setTarget(options, plan.file, "file");
            } else if (plan.url || plan.target) {
                setTarget(options, plan.url || plan.target, "url");
            }
        }
        if (plan.profile && options.profile === "default") {
            options.profile = String(plan.profile);
        }
        if (Array.isArray(plan.checks)) {
            options.checks.push(...plan.checks.map(String));
        }
        if (Array.isArray(plan.manualChecks)) {
            options.checks.push(...plan.manualChecks.map(String));
        }
        const steps = Array.isArray(plan.steps) ? plan.steps : [];
        for (const step of steps) {
            options.steps.push(normalizePlanStep(step, planFile));
        }
    }
}

// Normalizes compact JSON plan aliases into the internal step vocabulary.
function normalizePlanStep(rawStep, source) {
    if (!rawStep || typeof rawStep !== "object") {
        return { type: "unsupported", description: "plan step is not an object", source };
    }
    const rawType = rawStep.type || rawStep.action || rawStep.assert || "";
    const aliases = {
        "assert-text": "assertText",
        text: "assertText",
        containsText: "assertText",
        "assert-no-text": "assertNoText",
        noText: "assertNoText",
        "assert-visible": "assertVisible",
        visible: "assertVisible",
        "assert-hidden": "assertHidden",
        hidden: "assertHidden",
        "assert-url-contains": "assertUrlContains",
        urlContains: "assertUrlContains",
        "assert-url-matches": "assertUrlMatches",
        urlMatches: "assertUrlMatches",
        wait: "waitForSelector",
        "wait-for": "waitForSelector",
        waitFor: "waitForSelector",
        waitForSelector: "waitForSelector",
        click: "click",
        fill: "fill",
        press: "press",
        screenshot: "screenshot",
    };
    return {
        ...rawStep,
        type: aliases[String(rawType)] || String(rawType),
        source,
        description: rawStep.description || rawStep.name || "",
    };
}

// Builds the evidence cache key from ticket, code state, target, and checklist.
function buildRunIdentity(options) {
    const head = runGit(["rev-parse", "HEAD"]) || "unknown";
    const diffMaterial = [
        runGit(["diff", "--no-ext-diff", "--binary", "HEAD", "--"]),
        runGit(["diff", "--cached", "--no-ext-diff", "--binary", "--"]),
        runGit(["status", "--short", "--untracked-files=all"]),
    ].join("\n--- easelect ai acceptance boundary ---\n");
    const diffHash = sha256(diffMaterial);
    const planHash = sha256(JSON.stringify({
        target: options.target,
        targetSource: options.targetSource,
        profile: options.profile,
        viewport: options.viewport,
        checks: options.checks,
        steps: options.steps,
        ensureLogin: options.ensureLogin,
        useAuthState: options.useAuthState,
        authState: options.authState,
    }));
    const fingerprint = sha256(JSON.stringify({
        ticketId: options.ticketId,
        head,
        diffHash,
        planHash,
        target: options.target,
        profile: options.profile,
    })).slice(0, 20);
    return { head, diffHash, planHash, fingerprint };
}

// Runs git read-only commands without letting unavailable metadata block testing.
function runGit(args) {
    try {
        return execFileSync("git", args, {
            cwd: repoRoot,
            encoding: "utf8",
            maxBuffer: 30 * 1024 * 1024,
        }).trim();
    } catch (_error) {
        return "";
    }
}

// Hashes identity material for stable artifact cache paths.
function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

// Returns the artifact directory for this exact acceptance scenario.
function resolveOutputDir(options, identity) {
    if (options.outputDir) {
        fs.mkdirSync(options.outputDir, { recursive: true });
        return options.outputDir;
    }
    const ticket = options.ticketId ? `ticket-${options.ticketId}` : "no-ticket";
    const profile = slugify(options.profile || "default");
    const outputDir = path.join(defaultArtifactRoot, ticket, `${profile}-${identity.fingerprint}`);
    fs.mkdirSync(outputDir, { recursive: true });
    return outputDir;
}

// Turns a label into a safe path segment for artifact names.
function slugify(value) {
    const slug = String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return slug || "item";
}

// Prints a compact CLI summary with paths the caller can paste into close prep.
function printSummary(result, cached = false) {
    console.log(`AI acceptance ${cached ? "cached " : ""}verdict: ${result.verdict}`);
    console.log(`- Target: ${result.target}`);
    console.log(`- Final URL: ${result.finalUrl}`);
    console.log(`- Replacement: ${result.replacement.browserTesting}`);
    console.log(`- Result: ${result.artifacts.result}`);
    console.log(`- Report: ${result.artifacts.report}`);
    if (result.artifacts.screenshot) {
        console.log(`- Screenshot: ${result.artifacts.screenshot}`);
    }
}

// Converts verdicts into automation-friendly process status codes.
function exitCodeForVerdict(verdict) {
    if (verdict === "pass") {
        return 0;
    }
    if (verdict === "fail") {
        return 2;
    }
    return 3;
}

// Coordinates argument parsing, cache reuse, browser execution, and exit status.
async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }
    loadPlanFiles(options);
    if (!options.ticketId) {
        throw new Error("missing <ticket-id>; use 0 for non-ticket acceptance evidence");
    }
    if (!options.target) {
        throw new Error("missing target; pass --url, --file, or a plan file with url/file");
    }
    const identity = buildRunIdentity(options);
    const outputDir = resolveOutputDir(options, identity);
    const resultPath = path.join(outputDir, "ai_acceptance_result.json");
    if (!options.force && fs.existsSync(resultPath)) {
        const cached = JSON.parse(fs.readFileSync(resultPath, "utf8"));
        printSummary(cached, true);
        process.exitCode = exitCodeForVerdict(cached.verdict);
        return;
    }
    const result = await runAcceptance(options, identity, outputDir);
    printSummary(result, false);
    process.exitCode = exitCodeForVerdict(result.verdict);
}

main().catch((error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
