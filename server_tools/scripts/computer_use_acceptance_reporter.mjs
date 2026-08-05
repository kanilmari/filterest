// computer_use_acceptance_reporter.mjs - Computer Use evidence report renderer.
// Bridges machine-readable Computer Use results and human-readable close-prep evidence.
// Produces concise markdown without touching ticket state or browser execution.
// Exists so the runner can stay focused on API and Playwright action loops.

// Renders the human-readable evidence report for a Computer Use run.
export function renderComputerUseReport(result) {
    const lines = [
        `# Computer Use Acceptance Report - ${result.verdict.toUpperCase()}`,
        "",
        "This report is live Computer Use browser evidence. It does not close the ticket or override project governance.",
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
        `- **Model**: ${result.model}`,
        `- **Viewport**: ${result.viewport.name} (${result.viewport.width}x${result.viewport.height})`,
        `- **Stopped reason**: ${result.stoppedReason || "(none)"}`,
        "",
        "## Acceptance Scope",
        "",
    ];
    lines.push(...(result.checks.length ? result.checks : ["No explicit checks were supplied."]).map((item) => `- ${item}`));
    lines.push("", "## Model Summary", "", result.modelDecision.summary || "(none)");
    appendCoveredChecks(lines, result);
    appendFindings(lines, result);
    appendArtifacts(lines, result);
    appendCounts(lines, result);
    return `${lines.join("\n")}\n`;
}

// Adds covered-check evidence if the model supplied it.
function appendCoveredChecks(lines, result) {
    if (!result.modelDecision.coveredChecks.length) {
        return;
    }
    lines.push("", "## Covered Checks", "");
    lines.push(...result.modelDecision.coveredChecks.map((item) => `- ${item}`));
}

// Adds UX or acceptance findings if the model supplied them.
function appendFindings(lines, result) {
    if (!result.modelDecision.findings.length) {
        return;
    }
    lines.push("", "## Findings", "");
    for (const finding of result.modelDecision.findings) {
        lines.push(`- **${finding.severity || "P3"} ${finding.title || "Finding"}**: ${finding.evidence || ""}`);
        if (finding.suggestedTicket) {
            lines.push(`  Suggested ticket: ${finding.suggestedTicket}`);
        }
    }
}

// Adds evidence file paths.
function appendArtifacts(lines, result) {
    lines.push(
        "",
        "## Evidence Artifacts",
        "",
        `- **Result JSON**: ${result.artifacts.result}`,
        `- **Screenshot**: ${result.artifacts.screenshot}`,
        `- **Actions**: ${result.artifacts.actions}`,
        `- **Responses**: ${result.artifacts.responses}`,
        `- **Browser evidence**: ${result.artifacts.browserEvidence}`,
    );
}

// Adds compact evidence counters.
function appendCounts(lines, result) {
    lines.push(
        "",
        "## Counts",
        "",
        `- **Computer actions**: ${result.counts.actions}`,
        `- **Blocked requests**: ${result.counts.blockedRequests}`,
        `- **Console errors**: ${result.counts.consoleErrors}`,
        `- **Page errors**: ${result.counts.pageErrors}`,
        `- **Findings**: ${result.counts.findings}`,
        "",
    );
}
