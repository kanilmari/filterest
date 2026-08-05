// browser_audit.mjs — Local browser audit orchestration.
// Bridges one target URL, Playwright screenshots, axe, Lighthouse, and Visual Guardian vision output.
// Writes a single markdown report plus machine-readable artifacts for developer review.
// Exists to make browser UX, accessibility, performance, and SEO audits repeatable from one CLI.
/* global CSS, document, window, HTMLElement */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
    buildFindings,
    writeDbTaskDraft,
    writeIssueSummary,
    writeMarkdownReport,
} from "./browser_audit_reporter.mjs";
import { isLocalEaselectUrl } from "./local_easelect_target.mjs";

const repoRoot = process.cwd();
const defaultArtifactRoot = path.join(repoRoot, "agent_tasks/_artifacts/browser_audits");
const defaultAuthState = path.join(repoRoot, "testing/e2e/.auth/user.json");
const defaultViewport = { width: 1440, height: 900, name: "desktop" };
const auditCategories = ["performance", "accessibility", "best-practices", "seo"];

// Shows CLI usage and connects npm-script pass-through with Filterest dispatch.
function usage() {
    return `Usage: ./filterest audit browser --url <URL> [options]

Options:
  --url <URL>                Absolute URL to audit.
  --output-dir <path>        Artifact directory. Defaults to timestamped browser_audits folder.
  --viewport <WxH|desktop|mobile|tablet>
                             Capture viewport. Default: desktop (1440x900).
  --auth-state <path>        Playwright storageState JSON for authenticated local audits.
                             Default: testing/e2e/.auth/user.json when auditing localhost:8082.
  --no-auth-state            Do not reuse Playwright auth state.
  --capture-only             Capture screenshot and DOM summary only.
  --skip-vision              Skip AI vision analysis.
  --skip-axe                 Skip axe accessibility analysis.
  --skip-lighthouse          Skip Lighthouse analysis.
  --issue-summary            Also write browser_audit_issue_summary.md.
  --db-task-draft            Also write a non-mutating DB ticket draft.
  --settle-ms <ms>           Extra wait after load before capture. Default: 1000.
  --help                     Show this help.

Examples:
  ./filterest audit browser --url https://localhost:8082
  ./filterest audit browser --url https://example.com --skip-vision
  npm run audit:browser -- --url https://localhost:8082
  npm run audit:browser:full -- --url https://localhost:8082`;
}

// Parses simple flag arguments without adding another dependency to the repo.
function parseArgs(argv) {
    const options = {
        url: null,
        outputDir: null,
        viewport: defaultViewport,
        authState: defaultAuthState,
        useAuthState: true,
        captureOnly: false,
        skipVision: false,
        skipAxe: false,
        skipLighthouse: false,
        issueSummary: false,
        dbTaskDraft: false,
        settleMs: 1000,
    };

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
        } else if (arg === "--") {
            continue;
        } else if (arg === "--url") {
            options.url = next();
        } else if (arg.startsWith("--url=")) {
            options.url = arg.slice("--url=".length);
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
        } else if (arg.startsWith("--auth-state=")) {
            options.authState = path.resolve(arg.slice("--auth-state=".length));
        } else if (arg === "--no-auth-state") {
            options.useAuthState = false;
        } else if (arg === "--capture-only") {
            options.captureOnly = true;
            options.skipVision = true;
            options.skipAxe = true;
            options.skipLighthouse = true;
        } else if (arg === "--skip-vision") {
            options.skipVision = true;
        } else if (arg === "--skip-axe") {
            options.skipAxe = true;
        } else if (arg === "--skip-lighthouse") {
            options.skipLighthouse = true;
        } else if (arg === "--issue-summary") {
            options.issueSummary = true;
        } else if (arg === "--db-task-draft") {
            options.dbTaskDraft = true;
            options.issueSummary = true;
        } else if (arg === "--settle-ms") {
            options.settleMs = parsePositiveInt(next(), "--settle-ms");
        } else if (arg.startsWith("--settle-ms=")) {
            options.settleMs = parsePositiveInt(arg.slice("--settle-ms=".length), "--settle-ms");
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }

    return options;
}

// Converts named or explicit viewport arguments into Playwright dimensions.
function parseViewport(value) {
    const named = {
        desktop: { width: 1440, height: 900, name: "desktop" },
        tablet: { width: 768, height: 1024, name: "tablet" },
        mobile: { width: 375, height: 667, name: "mobile" },
    };
    if (named[value]) {
        return named[value];
    }

    const match = value.match(/^(\d{3,5})x(\d{3,5})$/i);
    if (!match) {
        throw new Error(`invalid viewport "${value}", expected desktop, tablet, mobile, or WIDTHxHEIGHT`);
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

// Normalizes and validates the audited URL so all tools receive an absolute target.
function parseTargetUrl(rawUrl) {
    if (!rawUrl) {
        throw new Error("missing required --url <URL>");
    }
    let target;
    try {
        target = new URL(rawUrl);
    } catch (_error) {
        throw new Error(`invalid --url "${rawUrl}", expected an absolute URL such as https://localhost:8082`);
    }
    if (!["http:", "https:"].includes(target.protocol)) {
        throw new Error(`unsupported URL protocol "${target.protocol}", expected http or https`);
    }
    return target;
}

// Creates the stable timestamped artifact directory for this audit run.
function resolveOutputDir(options, targetUrl) {
    if (options.outputDir) {
        fs.mkdirSync(options.outputDir, { recursive: true });
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
    const slug = slugify(`${targetUrl.hostname}${targetUrl.pathname}`);
    const outputDir = path.join(defaultArtifactRoot, `${stamp}--${slug}`);
    fs.mkdirSync(outputDir, { recursive: true });
    return outputDir;
}

// Turns a URL-ish label into a filesystem-safe artifact suffix.
function slugify(value) {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return slug || "url";
}

// Captures the target page, DOM summary, screenshot, and axe results from one browser session.
async function runPlaywrightAudit(options, targetUrl, outputDir) {
    const screenshotPath = path.join(outputDir, `screenshot-${options.viewport.name}.png`);
    const domSnapshotPath = path.join(outputDir, "dom_snapshot.json");
    const axePath = path.join(outputDir, "axe.json");
    const localTarget = isLocalEaselectUrl(targetUrl);
    const authStatePath = options.useAuthState && localTarget && fs.existsSync(options.authState)
        ? options.authState
        : undefined;

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: options.viewport.width, height: options.viewport.height },
        storageState: authStatePath,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: localTarget ? { "X-Bypass-Ratelimit": "test-mode" } : {},
    });
    const page = await context.newPage();

    try {
        page.setDefaultTimeout(30000);
        const navigation = await page.goto(targetUrl.toString(), {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });
        if (!navigation) {
            throw new Error("browser navigation did not return a response");
        }
        if (navigation.status() >= 400) {
            throw new Error(`browser navigation returned HTTP ${navigation.status()} for ${targetUrl}`);
        }
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(options.settleMs);

        const domSnapshot = await collectDomSnapshot(page, targetUrl);
        fs.writeFileSync(domSnapshotPath, JSON.stringify(domSnapshot, null, 2));

        await page.screenshot({ path: screenshotPath, fullPage: true });

        let axeResult = null;
        if (!options.skipAxe) {
            axeResult = await new AxeBuilder({ page }).analyze();
            fs.writeFileSync(axePath, JSON.stringify(axeResult, null, 2));
        }

        return {
            authStatePath,
            screenshotPath,
            domSnapshotPath,
            axePath: axeResult ? axePath : null,
            domSnapshot,
            axeResult,
        };
    } finally {
        await browser.close();
    }
}

// Pulls a compact page-structure model from the live DOM for the markdown report.
async function collectDomSnapshot(page, targetUrl) {
    return page.evaluate((href) => {
        const cleanText = (value) => (value || "").replace(/\s+/g, " ").trim();
        const selectorFor = (element) => {
            if (!(element instanceof HTMLElement)) {
                return "";
            }
            if (element.id) {
                return `#${element.id}`;
            }
            if (element.dataset?.testid) {
                return `[data-testid="${element.dataset.testid}"]`;
            }
            const tag = element.tagName.toLowerCase();
            const name = element.getAttribute("name");
            if (name) {
                return `${tag}[name="${name}"]`;
            }
            return tag;
        };
        const labelTextFor = (control) => {
            if (!(control instanceof HTMLElement)) {
                return "";
            }
            const id = control.id;
            if (id) {
                const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                if (explicit) {
                    return cleanText(explicit.textContent);
                }
            }
            const parentLabel = control.closest("label");
            return parentLabel ? cleanText(parentLabel.textContent) : "";
        };

        const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
            .map((heading) => ({
                level: Number.parseInt(heading.tagName.slice(1), 10),
                text: cleanText(heading.textContent),
                selector: selectorFor(heading),
            }))
            .filter((heading) => heading.text);

        const links = Array.from(document.querySelectorAll("a[href]"))
            .map((link) => ({
                text: cleanText(link.textContent),
                href: link.href,
                ariaLabel: link.getAttribute("aria-label") || "",
                target: link.getAttribute("target") || "",
                selector: selectorFor(link),
            }));

        const images = Array.from(document.querySelectorAll("img"))
            .map((image) => ({
                src: image.currentSrc || image.src || "",
                alt: image.getAttribute("alt"),
                ariaLabel: image.getAttribute("aria-label") || "",
                role: image.getAttribute("role") || "",
                width: image.naturalWidth || image.width || 0,
                height: image.naturalHeight || image.height || 0,
                selector: selectorFor(image),
            }));

        const controlsFor = (form) => Array.from(form.querySelectorAll("input,select,textarea,button"))
            .map((control) => ({
                tag: control.tagName.toLowerCase(),
                type: control.getAttribute("type") || "",
                name: control.getAttribute("name") || "",
                id: control.id || "",
                required: control.hasAttribute("required"),
                placeholder: control.getAttribute("placeholder") || "",
                ariaLabel: control.getAttribute("aria-label") || "",
                labelText: labelTextFor(control),
                selector: selectorFor(control),
            }));

        const forms = Array.from(document.querySelectorAll("form"))
            .map((form) => ({
                id: form.id || "",
                name: form.getAttribute("name") || "",
                action: form.action || "",
                method: form.method || "get",
                controls: controlsFor(form),
                selector: selectorFor(form),
            }));

        const buttons = Array.from(document.querySelectorAll("button,[role=\"button\"]"))
            .map((button) => ({
                text: cleanText(button.textContent),
                ariaLabel: button.getAttribute("aria-label") || "",
                title: button.getAttribute("title") || "",
                selector: selectorFor(button),
            }));

        const landmarks = Array.from(document.querySelectorAll("main,nav,header,footer,aside,section,[role]"))
            .map((element) => ({
                tag: element.tagName.toLowerCase(),
                role: element.getAttribute("role") || "",
                label: element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") || "",
                selector: selectorFor(element),
            }))
            .slice(0, 80);

        return {
            url: window.location.href || href,
            title: document.title || "",
            lang: document.documentElement.lang || "",
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio,
            },
            counts: {
                headings: headings.length,
                links: links.length,
                images: images.length,
                forms: forms.length,
                buttons: buttons.length,
                landmarks: landmarks.length,
            },
            headings,
            links: links.slice(0, 60),
            images: images.slice(0, 80),
            forms,
            buttons: buttons.slice(0, 80),
            landmarks,
        };
    }, targetUrl.toString());
}

// Runs the existing Visual Guardian AI vision analyzer and reads its JSON output.
function runVisionAudit(options, outputDir, screenshotPath) {
    if (options.skipVision) {
        return null;
    }

    const context = `General browser audit for ${options.url}; no application code change is being evaluated. Evaluate layout, contrast, visual hierarchy, overlap, and obvious usability issues.`;
    const question = "What concrete visual, layout, or contrast improvements should the developer make first?";
    const result = spawnSync("python3", [
        "testing/visual_guardian/analyze_ui.py",
        "--screenshot",
        outputDir,
        "--context",
        context,
        "--question",
        question,
    ], {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
    });

    fs.writeFileSync(path.join(outputDir, "vision_stdout.log"), result.stdout || "");
    fs.writeFileSync(path.join(outputDir, "vision_stderr.log"), result.stderr || "");
    if (result.status !== 0) {
        throw new Error(
            `vision analysis failed with exit code ${result.status}. ` +
            `Check ${path.join(outputDir, "vision_stderr.log")} and confirm OPENAI_API_KEY or ANTHROPIC_API_KEY is configured.`,
        );
    }

    const reportPath = path.join(outputDir, "report.json");
    if (!fs.existsSync(reportPath)) {
        throw new Error(`vision analysis did not write ${reportPath}`);
    }
    const visionReport = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const failed = (visionReport.results || []).find((item) => item.analysis?.status === "ERROR");
    if (failed) {
        throw new Error(
            `vision analysis returned ERROR for ${failed.image}: ${(failed.analysis?.issues || []).join("; ")}`,
        );
    }

    const renamedPath = path.join(outputDir, "vision_report.json");
    fs.renameSync(reportPath, renamedPath);
    visionReport.reportPath = renamedPath;
    visionReport.screenshotPath = screenshotPath;
    return visionReport;
}

// Runs Lighthouse through its CLI so the same command works without a custom browser server.
function runLighthouseAudit(options, targetUrl, outputDir, authStatePath) {
    if (options.skipLighthouse) {
        return null;
    }

    const outputPath = path.join(outputDir, "lighthouse.json");
    const headerPath = path.join(outputDir, "lighthouse_headers.json");
    const headers = buildLighthouseHeaders(targetUrl, authStatePath);
    if (Object.keys(headers).length > 0) {
        fs.writeFileSync(headerPath, JSON.stringify(headers, null, 2));
    }

    const args = [
        "lighthouse",
        targetUrl.toString(),
        "--quiet",
        "--output=json",
        `--output-path=${outputPath}`,
        `--only-categories=${auditCategories.join(",")}`,
        "--chrome-flags=--headless=new --ignore-certificate-errors --no-sandbox --disable-dev-shm-usage",
        "--preset=desktop",
    ];
    if (Object.keys(headers).length > 0) {
        args.push(`--extra-headers=${headerPath}`);
    }

    const result = spawnSync("npx", args, {
        cwd: repoRoot,
        env: { ...process.env, CHROME_PATH: chromium.executablePath() },
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
    });

    fs.writeFileSync(path.join(outputDir, "lighthouse_stdout.log"), result.stdout || "");
    fs.writeFileSync(path.join(outputDir, "lighthouse_stderr.log"), result.stderr || "");
    if (result.status !== 0) {
        throw new Error(
            `Lighthouse failed with exit code ${result.status}. ` +
            `Check ${path.join(outputDir, "lighthouse_stderr.log")} and verify Chrome can open the target URL.`,
        );
    }
    if (!fs.existsSync(outputPath)) {
        throw new Error(`Lighthouse did not write ${outputPath}`);
    }

    return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

// Builds auth and test-mode headers for Lighthouse from Playwright storage state.
function buildLighthouseHeaders(targetUrl, authStatePath) {
    const headers = {};
    if (isLocalEaselectUrl(targetUrl)) {
        headers["X-Bypass-Ratelimit"] = "test-mode";
    }
    if (!authStatePath || !fs.existsSync(authStatePath)) {
        return headers;
    }

    const state = JSON.parse(fs.readFileSync(authStatePath, "utf8"));
    const cookies = (state.cookies || []).filter((cookie) => cookieMatchesTarget(cookie, targetUrl));
    if (cookies.length > 0) {
        headers.Cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    }
    return headers;
}

// Applies browser-domain cookie matching enough for localhost and public URLs.
function cookieMatchesTarget(cookie, targetUrl) {
    const domain = (cookie.domain || "").replace(/^\./, "");
    if (!domain) {
        return false;
    }
    const host = targetUrl.hostname;
    return host === domain || host.endsWith(`.${domain}`);
}

// Coordinates the full audit pipeline and prints the generated report path.
async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }
    const targetUrl = parseTargetUrl(options.url);
    options.url = targetUrl.toString();
    const outputDir = resolveOutputDir(options, targetUrl);

    try {
        const capture = await runPlaywrightAudit(options, targetUrl, outputDir);
        const lighthouseResult = runLighthouseAudit(options, targetUrl, outputDir, capture.authStatePath);
        const visionReport = runVisionAudit(options, outputDir, capture.screenshotPath);
        const findings = buildFindings({
            domSnapshot: capture.domSnapshot,
            axeResult: capture.axeResult,
            lighthouseResult,
            visionReport,
        });
        const reportPath = writeMarkdownReport({
            repoRoot,
            options,
            targetUrl: targetUrl.toString(),
            outputDir,
            capture,
            lighthouseResult,
            visionReport,
            findings,
        });
        if (options.issueSummary) {
            const issueSummaryPath = writeIssueSummary({
                repoRoot,
                targetUrl: targetUrl.toString(),
                outputDir,
                reportPath,
                findings,
            });
            console.log(`Issue summary saved to ${issueSummaryPath}`);
        }
        if (options.dbTaskDraft) {
            const taskDraftPath = writeDbTaskDraft({
                repoRoot,
                targetUrl: targetUrl.toString(),
                outputDir,
                reportPath,
                findings,
            });
            console.log(`DB task draft saved to ${taskDraftPath}`);
        }
        console.log(`Report saved to ${reportPath}`);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`error: browser audit failed: ${reason}`);
        console.error(`next: open the target manually, verify the server is reachable, and inspect artifacts in ${outputDir}`);
        process.exitCode = 1;
    }
}

main();
