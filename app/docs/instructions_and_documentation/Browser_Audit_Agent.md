<!-- Browser_Audit_Agent.md
What: Documents the public command for repeatable single-page browser audits.
Between what: Connects operator audit requests, local browser tooling, and generated reports.
Why: Keeps accessibility, performance, and visual review reproducible outside Easelect.
-->
# Browser Audit Agent

`./filterest audit browser` runs a one-page browser audit from the local repo. It opens a
URL with Playwright, captures a full-page screenshot, summarizes the DOM, runs
axe accessibility checks, runs Lighthouse, asks the Visual Guardian vision model
to review the screenshot, and writes one prioritized markdown report.

## Commands

```bash
./filterest audit browser --url https://localhost:8100
./filterest audit browser --url https://example.com --skip-vision
./filterest audit browser --url https://localhost:8100 --issue-summary --db-task-draft
./filterest audit browser --url https://localhost:8100 --capture-only
./filterest audit browser --url https://localhost:8100
```

The explicit `--capture-only` option skips the full analysis stages.
`audit:browser:full` runs the full pipeline.

## Output

Reports are written under:

```text
data/testing/browser_audits/YYYY-MM-DD--HH-MM-SS--<slug>/
```

The mutable root defaults to `data/testing/` outside immutable `app/` and may
be overridden with `FILTEREST_TEST_RUNTIME_ROOT` when an operator needs another
external test-runtime location.

Each run writes:

- `browser_audit_report.md` — human-readable prioritized report.
- `browser_audit_issue_summary.md` — compact follow-up summary when
  `--issue-summary` or `--db-task-draft` is passed.
- `browser_audit_db_task_draft.md` — non-mutating ticket draft when
  `--db-task-draft` is passed; it does not create a DB ticket.
- `screenshot-<viewport>.png` — full-page screenshot.
- `dom_snapshot.json` — headings, links, forms, buttons, images, and landmarks.
- `axe.json` — axe-core results when enabled.
- `lighthouse.json` — Lighthouse scores when enabled.
- `vision_report.json` — Visual Guardian output when enabled.

The CLI prints the markdown report path on stdout.

## Local Filterest Auth

For the standalone local target `https://localhost:8100`, the tool reuses
`data/testing/e2e/.auth/user.json` when it exists. That is the same Playwright
storage-state file produced by `app/testing/e2e/global-setup.ts`; no manual login is
needed after a normal E2E or Visual Guardian setup run.

If the auth file is missing, create it with a small Playwright run:

```bash
PLAYWRIGHT_HTML_OPEN=never ./filterest test testing/e2e/smoke.spec.ts --project=desktop-card --reporter=list
```

Use `--no-auth-state` when intentionally auditing the anonymous view.

## Vision Keys

The full pipeline uses `app/testing/visual_guardian/analyze_ui.py`, so it needs
`OPENAI_API_KEY` or `ANTHROPIC_API_KEY` available through the shell or `.env`.
Use `--skip-vision` for local capture, axe, and Lighthouse checks without an AI
provider call.

## Priority Model

- `P1`: blocking issue, accessibility violation, or security-sensitive finding.
- `P2`: significant usability, visual, or performance issue.
- `P3`: cosmetic polish or lower-risk quality improvement.

The command exits non-zero when navigation, axe execution, Lighthouse, or vision
execution fails. Findings themselves do not fail the command; they are reported
as prioritized rows for developer action.
