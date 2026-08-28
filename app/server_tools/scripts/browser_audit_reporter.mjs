// browser_audit_reporter.mjs — Report builder for browser_audit.
// Converts DOM, axe, Lighthouse, and vision artifacts into prioritized findings.
// Writes the markdown report consumed by developers after local browser audits.
// Exists separately so the browser orchestration script stays within project file-size limits.

import fs from "fs";
import path from "path";

const auditCategories = ["performance", "accessibility", "best-practices", "seo"];

// Converts all tool outputs into prioritized, concrete report findings.
export function buildFindings({ domSnapshot, axeResult, lighthouseResult, visionReport }) {
    const findings = [];
    findings.push(...buildDomFindings(domSnapshot));
    if (axeResult) {
        findings.push(...buildAxeFindings(axeResult));
    }
    if (lighthouseResult) {
        findings.push(...buildLighthouseFindings(lighthouseResult));
    }
    if (visionReport) {
        findings.push(...buildVisionFindings(visionReport));
    }
    return findings.sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority));
}

// Adds structural DOM findings that do not require AI or external audits.
function buildDomFindings(domSnapshot) {
    const findings = [];
    if (!domSnapshot.title) {
        findings.push(finding("P2", "DOM", "Page title is missing.", "Set a concise document title that identifies the current page or dataset.", "document.title"));
    }
    if (!domSnapshot.lang) {
        findings.push(finding("P1", "DOM", "Document language is missing.", "Set the `<html lang>` attribute to the active UI language so assistive tech can pronounce text correctly.", "WCAG 3.1.1"));
    }
    if (!domSnapshot.headings.some((heading) => heading.level === 1)) {
        findings.push(finding("P2", "DOM", "No H1 heading was found.", "Add one page-level H1 or equivalent semantic title for the audited surface.", "Heading hierarchy"));
    }

    const skipped = findSkippedHeadingLevels(domSnapshot.headings);
    if (skipped.length > 0) {
        findings.push(finding("P2", "DOM", `Heading levels skip at ${skipped.join(", ")}.`, "Restructure headings so levels increase one step at a time.", "Heading hierarchy"));
    }

    const imagesMissingAlt = domSnapshot.images.filter((image) => image.alt === null && image.role !== "presentation");
    if (imagesMissingAlt.length > 0) {
        findings.push(finding(
            "P1",
            "DOM",
            `${imagesMissingAlt.length} image(s) are missing alt attributes.`,
            "Add meaningful alt text for content images or `alt=\"\"` for decorative images.",
            "WCAG 1.1.1",
        ));
    }

    const unlabeledControls = domSnapshot.forms.flatMap((form) => form.controls)
        .filter((control) => ["input", "select", "textarea"].includes(control.tag))
        .filter((control) => !["hidden", "submit", "button", "reset"].includes(control.type))
        .filter((control) => !control.labelText && !control.ariaLabel);
    if (unlabeledControls.length > 0) {
        findings.push(finding(
            "P1",
            "DOM",
            `${unlabeledControls.length} form control(s) do not expose a label.`,
            "Connect each input/select/textarea to visible label text or an `aria-label`.",
            "WCAG 1.3.1 / 4.1.2",
        ));
    }

    const emptyLinks = domSnapshot.links.filter((link) => !link.text && !link.ariaLabel);
    if (emptyLinks.length > 0) {
        findings.push(finding(
            "P1",
            "DOM",
            `${emptyLinks.length} link(s) have no accessible name.`,
            "Add visible link text or an `aria-label` that states the destination or action.",
            "WCAG 2.4.4",
        ));
    }

    return findings;
}

// Detects skipped heading levels for the DOM summary section.
function findSkippedHeadingLevels(headings) {
    const skipped = [];
    let previous = 0;
    for (const heading of headings) {
        if (previous > 0 && heading.level > previous + 1) {
            skipped.push(`H${previous}->H${heading.level}`);
        }
        previous = heading.level;
    }
    return skipped;
}

// Converts axe violations into P1 accessibility findings with WCAG tags.
function buildAxeFindings(axeResult) {
    return (axeResult.violations || []).map((violation) => {
        const wcag = (violation.tags || [])
            .filter((tag) => /^wcag\d+/i.test(tag))
            .map((tag) => tag.toUpperCase())
            .join(", ") || "WCAG";
        const firstTargets = (violation.nodes || [])
            .slice(0, 3)
            .flatMap((node) => node.target || [])
            .join("; ");
        return finding(
            "P1",
            "axe",
            `${violation.help || violation.description} (${violation.nodes?.length || 0} node(s)).`,
            `${violation.description || violation.help}. Start with: ${firstTargets || "the affected nodes in axe.json"}.`,
            `${wcag} / ${violation.helpUrl || violation.id}`,
        );
    });
}

// Converts Lighthouse category scores and high-value audits into report findings.
function buildLighthouseFindings(lighthouseResult) {
    const findings = [];
    const categories = lighthouseResult.categories || {};
    for (const categoryName of auditCategories) {
        const category = categories[categoryName];
        if (!category || typeof category.score !== "number") {
            continue;
        }
        const score = Math.round(category.score * 100);
        if (categoryName === "accessibility" && score < 100) {
            findings.push(finding("P1", "Lighthouse", `Accessibility score is ${score}/100.`, "Review failing Lighthouse accessibility audits and fix them alongside axe violations.", "Lighthouse accessibility"));
        } else if (categoryName === "performance" && score < 70) {
            findings.push(finding("P2", "Lighthouse", `Performance score is ${score}/100.`, "Reduce render-blocking work, large assets, and main-thread time before release.", "Lighthouse performance"));
        } else if (score < 90) {
            findings.push(finding("P2", "Lighthouse", `${category.title} score is ${score}/100.`, `Review the lowest weighted ${category.title} audits in lighthouse.json.`, `Lighthouse ${categoryName}`));
        }
    }

    const audits = lighthouseResult.audits || {};
    const topAudits = Object.values(audits)
        .filter((audit) => audit && audit.score !== null && audit.score !== 1 && (audit.scoreDisplayMode === "numeric" || audit.scoreDisplayMode === "binary"))
        .filter((audit) => !["metrics", "screenshot-thumbnails", "final-screenshot"].includes(audit.id))
        .slice(0, 8);
    for (const audit of topAudits) {
        const priority = audit.id?.includes("csp") || audit.id?.includes("xss") ? "P1" : "P3";
        findings.push(finding(
            priority,
            "Lighthouse",
            audit.title || audit.id,
            audit.description ? stripMarkdownLinks(audit.description) : "Open lighthouse.json for the full audit details and affected nodes.",
            audit.id || "Lighthouse audit",
        ));
    }
    return findings;
}

// Converts Visual Guardian model output into layout/usability findings.
function buildVisionFindings(visionReport) {
    const findings = [];
    for (const result of visionReport.results || []) {
        const analysis = result.analysis || {};
        for (const issue of analysis.issues || []) {
            const lower = issue.toLowerCase();
            const priority = lower.includes("contrast") || lower.includes("obscur") || lower.includes("overlap")
                ? "P2"
                : "P3";
            findings.push(finding(
                priority,
                "Vision",
                issue,
                "Inspect the screenshot and adjust layout, spacing, contrast, or visual hierarchy in the affected UI surface.",
                result.image || "Visual Guardian",
            ));
        }
    }
    return findings;
}

// Removes markdown link syntax from Lighthouse descriptions for compact tables.
function stripMarkdownLinks(value) {
    return value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

// Creates one normalized report finding row.
function finding(priority, source, summary, suggestion, reference) {
    return { priority, source, summary, suggestion, reference };
}

// Keeps report findings ordered by the documented priority scale.
function priorityRank(priority) {
    return { P1: 1, P2: 2, P3: 3 }[priority] || 99;
}

// Writes the human-readable markdown report expected by the ticket.
export function writeMarkdownReport({ repoRoot, options, targetUrl, outputDir, capture, lighthouseResult, visionReport, findings }) {
    const reportPath = path.join(outputDir, "browser_audit_report.md");
    const lines = [];
    lines.push(`# Browser Audit Report`);
    lines.push("");
    lines.push(`- **URL**: ${targetUrl}`);
    lines.push(`- **Captured URL**: ${capture.domSnapshot.url}`);
    lines.push(`- **Viewport**: ${options.viewport.width}x${options.viewport.height} (${options.viewport.name})`);
    lines.push(`- **Generated**: ${new Date().toISOString()}`);
    lines.push(`- **Screenshot**: ${displayArtifactPath(repoRoot, capture.screenshotPath)}`);
    lines.push(`- **DOM snapshot**: ${displayArtifactPath(repoRoot, capture.domSnapshotPath)}`);
    if (capture.axePath) {
        lines.push(`- **axe JSON**: ${displayArtifactPath(repoRoot, capture.axePath)}`);
    }
    if (lighthouseResult) {
        lines.push(`- **Lighthouse JSON**: ${displayArtifactPath(repoRoot, path.join(outputDir, "lighthouse.json"))}`);
    }
    if (visionReport) {
        lines.push(`- **Vision JSON**: ${displayArtifactPath(repoRoot, visionReport.reportPath)}`);
    }
    lines.push("");
    lines.push(`## Priority Model`);
    lines.push("");
    lines.push(`- **P1**: blocking issue, accessibility violation, or security-sensitive finding.`);
    lines.push(`- **P2**: significant usability, visual, or performance issue.`);
    lines.push(`- **P3**: cosmetic polish or lower-risk quality improvement.`);
    lines.push("");
    lines.push(`## Scores`);
    lines.push("");
    if (lighthouseResult) {
        lines.push(`| Category | Score |`);
        lines.push(`|---|---:|`);
        for (const categoryName of auditCategories) {
            const category = lighthouseResult.categories?.[categoryName];
            const score = typeof category?.score === "number" ? `${Math.round(category.score * 100)}/100` : "n/a";
            lines.push(`| ${category?.title || categoryName} | ${score} |`);
        }
    } else {
        lines.push(`Lighthouse was skipped.`);
    }
    lines.push("");
    lines.push(`## DOM Snapshot Summary`);
    lines.push("");
    lines.push(`- **Title**: ${capture.domSnapshot.title || "(missing)"}`);
    lines.push(`- **Language**: ${capture.domSnapshot.lang || "(missing)"}`);
    lines.push(`- **Counts**: ${capture.domSnapshot.counts.headings} headings, ${capture.domSnapshot.counts.links} links, ${capture.domSnapshot.counts.images} images, ${capture.domSnapshot.counts.forms} forms, ${capture.domSnapshot.counts.buttons} buttons.`);
    lines.push(`- **Image alt text**: ${countImagesWithAlt(capture.domSnapshot.images)} with alt, ${capture.domSnapshot.images.filter((image) => image.alt === null).length} missing alt attribute.`);
    lines.push("");
    lines.push(`### Heading Hierarchy`);
    lines.push("");
    if (capture.domSnapshot.headings.length === 0) {
        lines.push(`No headings found.`);
    } else {
        for (const heading of capture.domSnapshot.headings.slice(0, 20)) {
            lines.push(`- H${heading.level}: ${heading.text}`);
        }
    }
    lines.push("");
    lines.push(`### Links And Forms`);
    lines.push("");
    lines.push(`- First links: ${capture.domSnapshot.links.slice(0, 8).map((link) => link.text || link.ariaLabel || link.href).join("; ") || "none"}`);
    lines.push(`- Forms: ${capture.domSnapshot.forms.map((form) => `${form.selector || "form"} (${form.controls.length} controls)`).join("; ") || "none"}`);
    lines.push("");
    lines.push(`## Findings`);
    lines.push("");
    if (findings.length === 0) {
        lines.push(`No findings were produced by the enabled audit stages.`);
    } else {
        lines.push(`| Priority | Source | Finding | Concrete Fix | Reference |`);
        lines.push(`|---|---|---|---|---|`);
        for (const item of findings) {
            lines.push(`| ${item.priority} | ${escapeTable(item.source)} | ${escapeTable(item.summary)} | ${escapeTable(item.suggestion)} | ${escapeTable(item.reference)} |`);
        }
    }
    lines.push("");
    lines.push(`## Vision Summary`);
    lines.push("");
    if (!visionReport) {
        lines.push(`Vision analysis was skipped.`);
    } else {
        for (const result of visionReport.results || []) {
            const analysis = result.analysis || {};
            lines.push(`### ${result.image}`);
            lines.push("");
            lines.push(`- **Status**: ${analysis.status || "unknown"}`);
            lines.push(`- **Device detected**: ${analysis.device_detected || "unknown"}`);
            lines.push(`- **Elements detected**: ${(analysis.elements_detected || []).join("; ") || "none reported"}`);
            lines.push("");
            lines.push(analysis.reasoning || "No reasoning returned.");
            lines.push("");
        }
    }

    fs.writeFileSync(reportPath, `${lines.join("\n")}\n`);
    return reportPath;
}

// Writes a compact follow-up summary that can be pasted into chat or a ticket.
export function writeIssueSummary({ repoRoot, targetUrl, outputDir, reportPath, findings }) {
    const summaryPath = path.join(outputDir, "browser_audit_issue_summary.md");
    const grouped = groupFindingsByPriority(findings);
    const lines = [
        "# Browser Audit Issue Summary",
        "",
        `- **URL**: ${targetUrl}`,
        `- **Report**: ${displayArtifactPath(repoRoot, reportPath)}`,
        `- **Generated**: ${new Date().toISOString()}`,
        "",
        "## Priority Counts",
        "",
        `- **P1**: ${(grouped.P1 || []).length}`,
        `- **P2**: ${(grouped.P2 || []).length}`,
        `- **P3**: ${(grouped.P3 || []).length}`,
        "",
        "## Follow-Up Items",
        "",
    ];

    if (findings.length === 0) {
        lines.push("No follow-up findings were produced by the enabled audit stages.");
    } else {
        for (const priority of ["P1", "P2", "P3"]) {
            const items = grouped[priority] || [];
            if (items.length === 0) {
                continue;
            }
            lines.push(`### ${priority}`);
            lines.push("");
            for (const item of items.slice(0, 12)) {
                lines.push(`- **${item.source}**: ${item.summary} Fix: ${item.suggestion}`);
            }
            lines.push("");
        }
    }

    fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`);
    return summaryPath;
}

// Writes a DB-task draft without calling ./db_task new or any mutation route.
export function writeDbTaskDraft({ repoRoot, targetUrl, outputDir, reportPath, findings }) {
    const draftPath = path.join(outputDir, "browser_audit_db_task_draft.md");
    const grouped = groupFindingsByPriority(findings);
    const title = `Browser audit follow-up: ${targetUrl}`;
    const lines = [
        "# DB Task Draft",
        "",
        "This is a draft only. Do not create a DB ticket unless the human explicitly approves it.",
        "",
        "## Suggested Title",
        "",
        title,
        "",
        "## Suggested Content",
        "",
        "```markdown",
        "## Source",
        "",
        `- Browser audit report: ${displayArtifactPath(repoRoot, reportPath)}`,
        `- Audited URL: ${targetUrl}`,
        "",
        "## Work Items",
        "",
    ];

    if (findings.length === 0) {
        lines.push("[todo] Review the browser audit report and confirm no follow-up work is needed.");
    } else {
        for (const priority of ["P1", "P2", "P3"]) {
            for (const item of (grouped[priority] || []).slice(0, 12)) {
                lines.push(`[todo] ${priority} ${item.source}: ${item.summary}`);
                lines.push(`      Fix direction: ${item.suggestion}`);
            }
        }
    }

    lines.push("");
    lines.push("## Verification");
    lines.push("");
    lines.push(`[todo] Re-run \`./filterest audit browser --url ${targetUrl} --issue-summary --db-task-draft\` after fixes.`);
    lines.push("");
    lines.push("## Closing Loop");
    lines.push("");
    lines.push("[to be fixed] Resolve or explicitly defer every P1/P2 browser audit finding.");
    lines.push("```");
    lines.push("");
    lines.push("## Suggested Create Command After Approval");
    lines.push("");
    lines.push("```bash");
    lines.push(`./db_task new ${shellQuote(title)} --issue-type task`);
    lines.push("# Then paste the Suggested Content with ./db_task update <id> --content-file <file>");
    lines.push("```");

    fs.writeFileSync(draftPath, `${lines.join("\n")}\n`);
    return draftPath;
}

// Groups findings so summaries keep the same priority model as the main report.
function groupFindingsByPriority(findings) {
    return findings.reduce((grouped, item) => {
        const priority = item.priority || "P3";
        grouped[priority] = grouped[priority] || [];
        grouped[priority].push(item);
        return grouped;
    }, {});
}

// Produces a POSIX-ish shell quote for suggested commands inside markdown drafts.
function shellQuote(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}

// Prints repo-relative paths for normal artifacts and absolute paths for external output dirs.
function displayArtifactPath(repoRoot, artifactPath) {
    const relative = path.relative(repoRoot, artifactPath);
    return relative.startsWith("..") || path.isAbsolute(relative) ? artifactPath : relative;
}

// Counts images with non-null alt attributes for the report summary.
function countImagesWithAlt(images) {
    return images.filter((image) => image.alt !== null).length;
}

// Escapes markdown table cell content.
function escapeTable(value) {
    return String(value || "")
        .replace(/\|/g, "\\|")
        .replace(/\n/g, " ")
        .trim();
}
