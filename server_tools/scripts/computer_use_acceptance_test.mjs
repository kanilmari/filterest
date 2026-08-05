// computer_use_acceptance_test.mjs - Computer Use acceptance CLI.
// Bridges ticket ids, prompt profiles, target parsing, resolved provider config, and runner output.
// Starts the sandboxed OpenAI Computer Use browser tester or dry-run wiring check.
// Exists as the live visual-AI alternative to structured ai-test and human QA.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { runComputerUseAcceptance } from "./computer_use_acceptance_runner.mjs";
import { addTargetHostToAllowedHosts, authStatePathForTarget } from "./local_easelect_target.mjs";
import { resolveEaselectPrivatePaths } from "../lib/easelect_private_paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const defaultAuthState = path.join(repoRoot, "testing/e2e/.auth/user.json");
const defaultArtifactRoot = path.join(repoRoot, "agent_tasks/_artifacts/human_qa/computer_use");
const defaultViewport = { width: 1024, height: 768, name: "computer-use-default" };
const defaultAllowedHosts = ["localhost:8082", "127.0.0.1:8082", "[::1]:8082"];

loadRootEnv();

// Shows the live Computer Use acceptance command contract.
function usage() {
    return `Usage:
  ./filterest audit human computer-use-test <ticket-id> --url <URL|route> [options]
  ./filterest audit human computer-use-test <ticket-id> --file <path> [options]

Options:
  --url <URL|route>          Browser target. Routes like /service_catalog use https://localhost:8082.
  --file <path>              File target to open in the browser.
  --check <text>             Acceptance checklist item; repeatable.
  --goal <text>              Extra custom prompt instruction; repeatable.
  --prompt-profile <name>    acceptance, ux-audit, release-readiness, regression-scout. Default: acceptance.
  --model <name>             OpenAI model. Default: OPENAI_COMPUTER_USE_MODEL or gpt-5.5.
  --max-steps <n>            Max computer actions. Default: 18.
  --viewport <WxH|desktop|mobile|tablet>
  --auth-state <path>        Playwright storageState JSON. Default: per-target under testing/e2e/.auth/.
  --no-auth-state            Do not reuse auth state.
  --no-ensure-login          Do not verify/refresh local Easelect login before testing.
  --headed                   Show Chromium while running.
  --dry-run                  Open/capture target and write evidence without calling OpenAI.
  --allow-host <host:port>   Additional allowed HTTP(S) host; repeatable.
  --allow-safety-checks      Acknowledge OpenAI pending safety checks instead of stopping.
  --output-dir <path>        Artifact directory. Defaults to timestamped ticket directory.
  --settle-ms <ms>           Extra wait after navigation and actions. Default: 1000.
  --timeout-ms <ms>          Playwright operation timeout. Default: 30000.
  --api-timeout-ms <ms>      OpenAI Responses request timeout. Default: 120000.
  --help                     Show this help.

Verdicts:
  pass           Computer Use reports the covered acceptance scope passed.
  fail           Computer Use found a concrete failure.
  inconclusive   Missing key/API support, safety gate, parse issue, or uncertain result.

Examples:
  ./filterest audit human computer-use-test 837 --url /service_catalog --prompt-profile ux-audit --check "Firefox card shows one media surface"
  ./filterest audit human computer-use-test 834 --file ../filterest/docs/publication/PUBLICATION_CHECKLIST.md --dry-run`;
}

// Reads the resolved runtime env into process.env without logging secrets.
function loadRootEnv() {
    const envPath = resolveEaselectPrivatePaths(repoRoot).runtimeEnvFile;
    if (!fs.existsSync(envPath)) {
        return;
    }
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || process.env[match[1]]) {
            continue;
        }
        process.env[match[1]] = unquoteEnv(match[2]);
    }
}

// Removes simple shell-style quotes from .env values.
function unquoteEnv(value) {
    const trimmed = String(value || "").trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

// Parses CLI flags into a Computer Use run plan.
function parseArgs(argv) {
    const args = [...argv];
    if (args[0] === "computer-use-test") {
        args.shift();
    }
    const options = defaultOptions();
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
        } else if (arg === "--check") {
            options.checks.push(take(arg));
        } else if (arg.startsWith("--check=")) {
            options.checks.push(arg.slice("--check=".length));
        } else if (arg === "--goal") {
            options.goals.push(take(arg));
        } else if (arg.startsWith("--goal=")) {
            options.goals.push(arg.slice("--goal=".length));
        } else if (arg === "--prompt-profile") {
            options.promptProfile = take(arg);
        } else if (arg.startsWith("--prompt-profile=")) {
            options.promptProfile = arg.slice("--prompt-profile=".length);
        } else if (arg === "--model") {
            options.model = take(arg);
        } else if (arg.startsWith("--model=")) {
            options.model = arg.slice("--model=".length);
        } else if (arg === "--max-steps") {
            options.maxSteps = parsePositiveInt(take(arg), "--max-steps");
        } else if (arg.startsWith("--max-steps=")) {
            options.maxSteps = parsePositiveInt(arg.slice("--max-steps=".length), "--max-steps");
        } else {
            parseRuntimeOption(options, arg, take);
        }
    }
    return options;
}

// Builds defaults after .env has been loaded.
function defaultOptions() {
    return {
        ticketId: null,
        target: null,
        targetSource: null,
        checks: [],
        goals: [],
        promptProfile: "acceptance",
        model: process.env.OPENAI_COMPUTER_USE_MODEL || "gpt-5.5",
        viewport: defaultViewport,
        authState: defaultAuthState,
        authStateExplicit: false,
        useAuthState: true,
        ensureLogin: true,
        headed: false,
        dryRun: false,
        allowSafetyChecks: false,
        allowedHosts: [...defaultAllowedHosts],
        outputDir: null,
        maxSteps: 18,
        settleMs: 1000,
        timeoutMs: 30000,
        apiTimeoutMs: 120000,
    };
}

// Parses browser/runtime flags shared with other QA helpers.
function parseRuntimeOption(options, arg, take) {
    if (arg === "--viewport") {
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
    } else if (arg === "--dry-run") {
        options.dryRun = true;
    } else if (arg === "--allow-safety-checks") {
        options.allowSafetyChecks = true;
    } else if (arg === "--allow-host") {
        options.allowedHosts.push(take(arg));
    } else if (arg.startsWith("--allow-host=")) {
        options.allowedHosts.push(arg.slice("--allow-host=".length));
    } else if (arg === "--output-dir") {
        options.outputDir = path.resolve(take(arg));
    } else if (arg.startsWith("--output-dir=")) {
        options.outputDir = path.resolve(arg.slice("--output-dir=".length));
    } else if (arg === "--settle-ms") {
        options.settleMs = parseNonNegativeInt(take(arg), "--settle-ms");
    } else if (arg.startsWith("--settle-ms=")) {
        options.settleMs = parseNonNegativeInt(arg.slice("--settle-ms=".length), "--settle-ms");
    } else if (arg === "--timeout-ms") {
        options.timeoutMs = parsePositiveInt(take(arg), "--timeout-ms");
    } else if (arg.startsWith("--timeout-ms=")) {
        options.timeoutMs = parsePositiveInt(arg.slice("--timeout-ms=".length), "--timeout-ms");
    } else if (arg === "--api-timeout-ms") {
        options.apiTimeoutMs = parsePositiveInt(take(arg), "--api-timeout-ms");
    } else if (arg.startsWith("--api-timeout-ms=")) {
        options.apiTimeoutMs = parsePositiveInt(arg.slice("--api-timeout-ms=".length), "--api-timeout-ms");
    } else {
        throw new Error(`unknown argument: ${arg}`);
    }
}

// Stores the resolved browser target and source kind.
function setTarget(options, rawValue, mode) {
    options.target = resolveTarget(rawValue, mode);
    options.targetSource = mode;
    applyTargetRuntimeDefaults(options);
}

// Keeps auth-state and host allowlist defaults aligned with explicit targets.
function applyTargetRuntimeDefaults(options) {
    addTargetHostToAllowedHosts(options.allowedHosts, options.target);
    if (!options.authStateExplicit) {
        options.authState = authStatePathForTarget(repoRoot, options.target, defaultAuthState);
    }
}

// Converts route/file shorthand into an absolute browser URL.
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
        desktop: { width: 1440, height: 900, name: "desktop" },
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

// Validates positive integer flags.
function parsePositiveInt(value, flagName) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${flagName} must be a positive integer`);
    }
    return parsed;
}

// Validates non-negative integer flags.
function parseNonNegativeInt(value, flagName) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${flagName} must be a non-negative integer`);
    }
    return parsed;
}

// Builds a unique run directory. Computer Use is intentionally not cached.
function resolveOutputDir(options) {
    if (options.outputDir) {
        fs.mkdirSync(options.outputDir, { recursive: true });
        return options.outputDir;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ticket = options.ticketId ? `ticket-${options.ticketId}` : "no-ticket";
    const dir = path.join(defaultArtifactRoot, ticket, `${slugify(options.promptProfile)}-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Turns labels into safe path segments.
function slugify(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "item";
}

// Returns the current git HEAD without blocking non-git smoke tests.
function gitHead() {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
    } catch (_error) {
        return "unknown";
    }
}

// Writes the run identity used for evidence inspection.
function writeRunIdentity(options, outputDir) {
    const head = gitHead();
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
        head,
        target: options.target,
        profile: options.promptProfile,
        checks: options.checks,
        goals: options.goals,
    })).digest("hex").slice(0, 20);
    fs.writeFileSync(path.join(outputDir, "run_identity.json"), JSON.stringify({
        head,
        target: options.target,
        profile: options.promptProfile,
        fingerprint,
    }, null, 2) + "\n", "utf8");
}

// Prints a compact CLI result.
function printSummary(result) {
    console.log(`Computer Use acceptance verdict: ${result.verdict}`);
    console.log(`- Target: ${result.target}`);
    console.log(`- Final URL: ${result.finalUrl}`);
    console.log(`- Replacement: ${result.replacement.browserTesting}`);
    console.log(`- Result: ${result.artifacts.result}`);
    console.log(`- Report: ${result.artifacts.report}`);
    console.log(`- Screenshot: ${result.artifacts.screenshot}`);
}

// Converts verdicts into automation-friendly process status codes.
function exitCodeForResult(result) {
    if (result.dryRun || result.verdict === "pass") {
        return 0;
    }
    if (result.verdict === "fail") {
        return 2;
    }
    return 3;
}

// Coordinates parsing, browser execution, API loop, and exit status.
async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }
    if (!options.ticketId) {
        throw new Error("missing <ticket-id>; use 0 for non-ticket acceptance evidence");
    }
    if (!options.target) {
        throw new Error("missing target; pass --url or --file");
    }
    const outputDir = resolveOutputDir(options);
    writeRunIdentity(options, outputDir);
    const result = await runComputerUseAcceptance(options, outputDir, repoRoot);
    printSummary(result);
    process.exitCode = exitCodeForResult(result);
}

main().catch((error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
