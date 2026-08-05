# Browser Audit Agent

`./filterest audit browser` runs a one-page browser audit from the local repo. It opens a
URL with Playwright, captures a full-page screenshot, summarizes the DOM, runs
axe accessibility checks, runs Lighthouse, asks the Visual Guardian vision model
to review the screenshot, and writes one prioritized markdown report.

## Commands

```bash
./filterest audit browser --url https://localhost:8082
./filterest audit browser --url https://example.com --skip-vision
./filterest audit browser --url https://localhost:8082 --issue-summary --db-task-draft
npm run audit:browser -- --url https://localhost:8082
npm run audit:browser:full -- --url https://localhost:8082
```

`npm run audit:browser` is the capture-only variant. `audit:browser:full` runs
the full pipeline.

## Output

Reports are written under:

```text
agent_tasks/_artifacts/browser_audits/YYYY-MM-DD--HH-MM-SS--<slug>/
```

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

## Local Easelect Auth

For `https://localhost:8082`, the tool reuses
`testing/e2e/.auth/user.json` when it exists. That is the same Playwright
storage-state file produced by `testing/e2e/global-setup.ts`; no manual login is
needed after a normal E2E or Visual Guardian setup run.

If the auth file is missing, create it with a small Playwright run:

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test testing/e2e/smoke.spec.ts --project=desktop-card --reporter=list
```

Use `--no-auth-state` when intentionally auditing the anonymous view.

## Vision Keys

The full pipeline uses `testing/visual_guardian/analyze_ui.py`, so it needs
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
