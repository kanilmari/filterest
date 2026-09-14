# Administrator Coding agent

The dataset chat offers API AI and, when configured, Coding agent (Codex).
The existing administrator route guards availability, submission and job status.
A regular user cannot enable it by changing browser storage or request fields.

## Site policy and readiness

`system_config.coding_agent_dev_only` is a boolean. Its installation default is
`true`: Coding agent is available only in the development environment. Setting it
to `false` allows administrators to use it in production as well. It never changes
the environment or grants administrator rights. A missing key uses the restrictive
default; an invalid present value or database error fails closed.

An administrator manages an existing site's value through the supported
`system_config` row API: locate the exact key, update only its boolean value using
the existing row ID, and read it back. For an older installation without the key,
use the supported Add row API with `key=coding_agent_dev_only`, `boolean_value=false`.
The application contains no domain list or automatic exception for old sites.
The release owner records the four explicitly authorized existing-site changes.
The current localhost, filterest.com, serlog.com and fintravel.fi installations
were set to false through the supported API; publishing this source does not
install its runner or deploy the production sites.

`GET /api/app/ai-chat/codex-query?dataset=DATASET` returns:

- `feature_enabled` and `dev_only`: site policy for the current environment.
- `runner_ready` and `runner_kind`: whether the selected execution adapter is ready.
- `authentication_verified`: a local CLI account-status check was successful.
- `reason_code`: a missing runner, tools, account or maintenance configuration.

GET does not start a model. Enabling the policy alone does not install a runner,
authenticate an account, verify quota, or start a paid request. The UI explains
when the enabled service still needs setup. It requests this live administrator
check when mounting the chat, including when the browser's cached route list
is missing or stale. The selector stays hidden and Codex disabled until the
request succeeds; denied or failed requests never enable the development
adapter as a fallback. Every later job request retains the backend checks.

## Existing development adapter

With no `FILTEREST_CODING_AGENT_SOCKET`, development POST requests retain the
existing synchronous adapter, configured by `FILTERBAR_AI_CODEX_COMMAND`,
`FILTERBAR_AI_CODEX_MODEL` and `FILTERBAR_AI_CODEX_TIMEOUT_SECONDS`. The existing default
`npx @openai/codex` launcher remains supported. Its availability check verifies
the launcher, not cached-package or account readiness; it reports
`authentication_verified=false`.

This adapter keeps its existing workspace, approval/sandbox behavior, optional
API planning call and 40-minute request timeout. A web-process restart can still
interrupt it. The durable runner below is optional in development and required
for production; production never falls back to the development adapter.

## Optional durable Unix runner

The release includes these deployable files in
[server_tools/agent_tools/coding_agent](../../server_tools/agent_tools/coding_agent/):
`coding_agent_runner.py`, `coding_agent_jobs.py`,
`coding_agent_maintenance.py`, the example JSON and the systemd unit.

The runner uses a dedicated non-root Unix account that differs from every web
process UID. A private Unix socket accepts only configured web peer UIDs and
the fixed site ID. The web handler supplies the authenticated administrator ID;
browser data cannot override the site, actor, executable, working directory or
maintenance command.

Use one runner/configuration/socket/job store per site. Keep the service code,
configuration and maintenance wrappers operator-owned and unwritable by both the
web account and coding jobs. Share only the socket group with the web process.
The sample UID, site, revision and paths are placeholders and deliberately do
not identify an existing deployment.

1. Install Python 3.10+, Git and the project's normal build/test dependencies
   outside the production web image. Install the pinned CLI into a dedicated
   tools prefix: `npm install --prefix /opt/filterest-coding-agent/tools --save-exact @openai/codex@0.154.0`.
2. Prepare a separate writable source checkout at
   `/srv/filterest-coding-agent/source`. Set `source_revision` to its verified
   full published commit. Do not use the live release directory or a checkout
   containing unfinished human edits.
3. Install the three Python modules in `/opt/filterest-coding-agent/runner/`
   with root ownership and read/execute access for the service account. Copy and
   fill `coding_agent_runner.example.json` as
   `/etc/filterest-coding-agent/site.json`, mode 0640, root-owned.
4. Provision the account's existing authorized Codex authentication in the
   configured `codex_home` through the normal operator flow. Verify
   `codex --version` and `codex login status` as that service account with
   `CODEX_HOME` set. Do not copy web database secrets into its environment.
5. Configure both fixed maintenance adapters described below. Then run, as the
   service account,
   `python3 /opt/filterest-coding-agent/runner/coding_agent_runner.py --config /etc/filterest-coding-agent/site.json --check`.
   This checks local tools/account/configuration without a model request.
6. Install and start the reviewed systemd unit. Give the web process group
   access to the socket, and set only
   `FILTEREST_CODING_AGENT_SOCKET=/run/filterest-coding-agent/runner.sock` and
   `FILTEREST_CODING_AGENT_SITE_ID=<same configured site>` in its environment.
   For a container, mount the socket's directory and use the actual host-visible
   web UID and matching supplementary group. Keep the application in production.
7. Verify the admin availability GET, non-admin rejection and an isolated
   test-runner dispatch before enabling real requests. Installing a runner is a
   separate maintenance action from publishing this release.

The runner starts one job at a time in a detached Git worktree at the configured
revision. Codex can edit/test this worktree; it does not edit the live site's
source checkout. The command sandbox allows workspace writes with command networking disabled.
A per-job request/receipt directory inside the worktree carries only fixed
maintenance actions to the runner. It grants no root access or arbitrary
deployment command. The web-to-runner transport remains a protected Unix socket.
Git publication and deployment remain subject to the source repository and
existing updater's protections. Operators review the job's changed paths and
test evidence; a successful coding response alone is not a published release.

The CLI flags and local account check follow the
[official CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
and [authentication documentation](https://learn.chatgpt.com/docs/auth).
The shipped adapter targets the pinned version above; validate a replacement
version with its local help and harmless sandbox probes before updating it.

## Existing maintenance tools

`maintenance_actions.plan` and `maintenance_actions.apply` contain fixed argv
arrays to operator-owned, site-bound wrappers. The only request substitution is
a validated numeric release version. The browser and model cannot supply shell
commands, paths, site names or arbitrary arguments. Parallel maintenance calls
are rejected; every result is appended to the job receipt.

For a standalone Filterest checkout the wrappers can call the existing
`./filterest update --version VERSION --dry-run` and
`./filterest update --version VERSION --yes` entry points. For a managed VPS,
bind them to that installation's existing guarded site-update workflow. Preserve
its backup, publication/commit identity, database compatibility, staging, cutover
and recovery checks. Do not substitute a bare `git pull`, container restart or
SQL command. These wrappers are deployment configuration, not universal scripts
that guess a site's layout or credentials.

The sample service uses `NoNewPrivileges=true` and read-only system files. A
wrapper requiring additional privilege will fail until the operator supplies a
specific supported delegation compatible with the unit. Do not grant the coding
process a broad sudo rule or Docker socket. `--check` verifies wrapper availability,
not a production cutover; use the existing updater's plan/rehearsal to verify the
site-specific delegation.

During a job the included maintenance client uses the fixed inbox directory
from its environment:
`python3 /opt/filterest-coding-agent/runner/coding_agent_maintenance.py --action plan --version X.Y.Z`.
Use `apply` only for an administrator's explicitly authorized operation.
The runner accepts requests only in the active job's pinned directory, rejects
symlinks and unknown fields, and records request IDs outside the writable
worktree so a duplicate cannot repeat the operation. The model can neither
choose another job directory nor overwrite the authoritative receipts.
This file bridge avoids relying on Unix socket access inside the Linux CLI
sandbox; that socket access failed an actual pinned-CLI probe.

## Requests, recovery and evidence

POST accepts the existing dataset/query/messages/lang payload plus a UUID
`request_id`. The external adapter returns HTTP 202 with `job_id` and status.
Polling uses the same administrator-only GET with `dataset` and `job_id`.
Only the initiating administrator can read that job, for the original dataset.
Repeating the same ID and same request is idempotent; changed content is rejected.

The UI saves only the job ID before dispatch and resumes status polling after
navigation or reload, without resubmitting the prompt. Closing the chat stops
polling; the accepted runner job continues. A web application restart leaves the
separate runner and job intact. A runner restart marks unfinished jobs
`interrupted`; it does not silently restart a potentially destructive operation.
The operator can inspect evidence and deliberately submit a new request.

Private job directories contain the request, prompt, execution log, answer,
worktree and atomic status/maintenance receipts. Keep them restricted to the
runner/operator and apply an explicit retention policy after jobs finish.
Timeouts terminate the entire command process group, including spawned tools.
The service uses control-group shutdown for its remaining child processes.
No automatic worktree pruning or evidence deletion occurs during a job.

Tests use a disposable Git repository, fake CLI and fixed fake updater, including
real Unix HTTP dispatch. They verify policy/admin/owner boundaries, isolated edits,
reconnect/restart receipts, one writer and timeouts without making model requests.
They do not claim a paid-model run or any production deployment.
