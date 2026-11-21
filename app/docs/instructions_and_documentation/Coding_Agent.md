# Administrator coding agent

The dataset chat's AI service selector offers API AI and, when this site permits
it and a runner is ready, the coding agent in one of two **modes**. Both modes
are jobs of one runner process, started from one engine module with one pinned
Codex version. The same administrator route guards availability, submission and
job status; a regular user cannot enable a mode by changing browser storage or
request fields.

| Mode | Selector name (en / fi) | What Codex may do | Where it is allowed |
|---|---|---|---|
| `code_workspace` | Code workspace (Codex) / Koodityötila (Codex) | Read and edit this machine's checkout, run tests and restart the development server, with network access | Development only, as a fixed rule (`ENVIRONMENT_TYPE=dev`); no setting widens it |
| `site_assistant` | Site assistant (Codex) / Sivustoavustaja (Codex) | Read the site through its own API with the asking administrator's rights; every write waits for approval in the chat | Development, and production when `coding_agent_dev_only` is `false` |

The chat shows the mode in the selector, in the waiting message and under the
answer ("Answered by: …"). There is no silent fallback: a mode is used only when
the live availability response lists it as ready.

## Site policy and availability

`system_config.coding_agent_dev_only` is a boolean. Its installation default is
`true`: the site assistant is available only in the development environment.
Setting it to `false` allows administrators to use the site assistant in
production. It never enables code work outside development, never changes the
environment and never grants administrator rights. A missing key uses the
restrictive default; an invalid present value or database error fails closed.

An administrator manages an existing site's value through the supported
`system_config` row API: locate the exact key, update only its boolean value using
the existing row ID, and read it back. For an older installation without the key,
use the supported Add row API with `key=coding_agent_dev_only`, `boolean_value=false`.

`GET /api/app/ai-chat/codex-query?dataset=DATASET` returns:

- `feature_enabled` and `dev_only`: whether any mode is permitted here.
- `modes`: each permitted mode the runner offers, with `ready`.
- `runner_ready`: whether at least one listed mode is ready.
- `authentication_verified`: a checked Codex account reported a ChatGPT
  subscription sign-in, rather than an API-key login.
- `reason_code`: why nothing is ready, for example `runner_not_configured`,
  `runner_not_running`, `runner_version_mismatch` or
  `runner_authentication_required`.

GET never starts a model. The runner intersects its offered modes with this
site's policy; an unreachable runner keeps the permitted modes visible but not
ready, so the chat can say the runner is not running.

Embedding refresh uses administrator-only, CSRF-checked `POST /api/embedding_stream_handler` with streamed progress through the ordinary request pipeline; an assistant needs an approved plan, and GET/HEAD return 405. `GET /api/check-db-consistency` (also HEAD) only reads and reports the last successful source scan time and staleness; startup and `POST /api/scan-lang-sources` own source scanning and orphan marking, while archiving remains paused. Scan time is unknown after restart until maintenance succeeds. Reviewed GET/HEAD side effects are bound to exact paths, handlers, profiles and reasons in the router's `safe_method_side_effect_allowlist.json`; the pre-grant checker rejects an unreviewed known writer, including at a new path. Session bookkeeping is outside that audit.

## One runner, one engine

The runner lives in
[server_tools/agent_tools/coding_agent](../../server_tools/agent_tools/coding_agent/):

- `coding_agent_runner.py` serves one site's jobs over a protected Unix socket.
  Its configuration lists the modes it offers under `modes`.
- `coding_agent_jobs.py` stores each job durably and runs it in its mode.
- `codex_engine.py` owns the pinned Codex version, each mode's exact argument
  list and the environment allowlist. `./worker_agent` uses the same module.
- `code_workspace_jobs.py` and `site_assistant_jobs.py` run the two modes.

Every job names its mode; the runner rechecks it against what it offers and
stores it with the job. The web server passes only the authenticated
administrator, the site ID and the request; commands, paths and site identity
never come from the browser.

**Codex never inherits the web server's environment.** It starts from an
allowlist (`PATH`, `LANG`, `LC_ALL`, `HOME`, plus the ordinary session settings a
code workspace needs such as `XDG_RUNTIME_DIR` and the Go cache paths) and the
runner configuration's own `environment`. Database passwords, session secrets
and API keys stay behind; project wrappers read credentials from the protected
key files themselves. A test fails if `DATABASE_PASSWORD` or a similar secret
reaches Codex.

The pinned version is `PINNED_CODEX_VERSION` in `codex_engine.py`. The runner
reports `runner_version_mismatch` for any other installed version. Upgrade it
deliberately: check the new version's `exec --help` and a harmless sandbox probe
first, then change the one constant.

Readiness checks each offered mode's actual command and account environment:
code work uses `codex_command`; the site assistant uses
`assistant_engine.command` when set, otherwise `codex_command`. The local Codex
checks are only `--version` and `login status`. As in `worker_agent`, a successful
status must contain the exact line `Logged in using ChatGPT` (trailing whitespace
is allowed) on stdout or stderr. An API-key sign-in or an empty successful status
is refused. Other engine names have no supported subscription readiness check
yet and return `runner_engine_unsupported`; a custom launch template does not
make them ready. A failed mode is excluded from the ready modes independently.

### Code workspace

Codex runs in the developer's own checkout with Codex's full-access sandbox and
network, the same access the old in-server launcher had, so tests, the database
wrappers and `./ctl` restarts keep working. The job runs outside the web server,
so a restart does not lose its answer. Before the job the application runs a
model-free filter probe: an exact `field:value` in the question becomes the
dataset's canonical read, and its result reaches Codex as backend context and
the chat as a filter plan. The job records Git status before and after, in the
checkout and in the product repository, and the answer lists the files that
changed.

A runner offers code work only with `identity: "same_user_workstation"`, so a
dedicated production runner cannot offer it even if configured to.

### Site assistant

Codex works in an empty private job folder with no network and no credentials.
It calls the site's API through a file bridge; the runner holds a one-time,
30-minute delegated session of the asking administrator. A refused write becomes
a waiting change the administrator approves in the chat; approval runs the
exact prepared calls with fresh access and no new model request. Approval is
refused for any job that is not a site assistant job.

### Attached images in both modes

Code workspace and Site assistant copy attached images only from the runner
configuration's explicit `upload_dir`. Set the web process's
`FILTEREST_CODING_AGENT_UPLOAD_DIR` to the
same absolute directory (including the same path in a container and on its host).
Use its canonical spelling: no leading or trailing Unicode whitespace, repeated
slashes, trailing slash (except `/`), or `.`/`..` segments. Ctl and runner
configuration reject another spelling, and the web writer refuses it without
creating an attachment. Values are never silently trimmed or cleaned; spaces
and newlines inside a directory name remain literal after dotenv decoding.
The browser sends tokens; the web attachment store resolves them into absolute
paths beneath that directory, and the runner checks every path before reading.
Only regular files whose real paths remain within the directory are accepted.
Symlinks in the file or any directory component, `..` paths, paths outside the
directory and missing files are refused. Without `upload_dir`, every attachment
is refused; questions with no attachments still work. A refusal fails the whole
job before checkout inspection, site access or engine execution, returns `error_code:
attachment_refused` in job status, and records the attachment number and reason
in the private `execution.log`. Copies made before the refusal are removed.
Accepted copies stay in the job's own folder: `attachments/` for Code workspace
and `workspace/` for Site assistant.

## Development machine: `./ctl agent`

Locally the runner is the developer's own user; no sudo is needed.

- `./ctl` starts the runner when it is missing and points the server at it
  (`FILTEREST_CODING_AGENT_SOCKET`, `FILTEREST_CODING_AGENT_SITE_ID` and
  `FILTEREST_SITE_ASSISTANT_BASE_URL`). Stopping or restarting the server leaves
  the runner and its jobs running. Without an installed Codex CLI the server
  still starts and the chat shows the runner as not running.
- `./ctl agent start|stop|restart|status|check` manage it directly. `check`
  verifies the pinned version, the ChatGPT subscription sign-in and each mode
  without a model request. Sign in once with `codex login`.
- Paths: configuration and jobs under
  `${XDG_STATE_HOME:-~/.local/state}/filterest-coding-agent/localhost-<port>/`
  (private), the socket in a private folder under `$XDG_RUNTIME_DIR`. The runner
  starts from a minimal environment, not the calling shell's.
- The launcher gives the web process and runner the same upload directory,
  normally `uploads/` beside the runner configuration. An explicit
  `FILTEREST_CODING_AGENT_UPLOAD_DIR` in the environment or development env file
  overrides it; `--init-workstation --upload-dir` writes the runner setting.
  Restart the local runner after upgrading an older configuration without it.
- The local site assistant reaches `https://localhost:<port>` and trusts the
  development certificate explicitly. It runs as the developer and could read
  the developer's files, so locally it is a functional test of the assistant,
  not a proof of its production boundary.
- To use an operator-managed runner instead, set
  `FILTEREST_CODING_AGENT_SOCKET` in the development env file; `./ctl` then
  leaves the runner alone. `FILTEREST_CODING_AGENT_AUTOSTART=0` keeps the
  runner from starting automatically.

## Production runner

A production site offers only the site assistant, through a dedicated non-root
Unix account that differs from every web process UID. The private socket
accepts only configured web peer UIDs and the fixed site ID. Use one
runner/configuration/socket/job store per site; keep the service code and
configuration operator-owned and unwritable by the web account.

1. Install Python 3.10+ outside the production web image and the pinned CLI into
   a dedicated tools prefix, for example
   `npm install --prefix /opt/filterest-coding-agent/tools --save-exact @openai/codex@<PINNED_CODEX_VERSION>`.
2. Install the runner modules (`coding_agent_runner.py`, `coding_agent_jobs.py`,
   `codex_engine.py`, `site_assistant_jobs.py`, `site_assistant_api_bridge.py`,
   `site_assistant_api_tool.py`, `site_assistant_inbox.py`, `upload_directory.py`) root-owned in
   `/opt/filterest-coding-agent/runner/`. Copy and fill
   `coding_agent_runner.example.json` as `/etc/filterest-coding-agent/site.json`,
   mode 0640, root-owned. It lists only `site_assistant` under `modes`.
3. Sign the service account in with the normal operator flow, for example
   `codex login --device-auth` with that account's `CODEX_HOME`, using the ChatGPT
   subscription flow. An API-key login does not make the runner ready. Do not
   copy web database secrets into its environment.
4. Run, as the service account,
   `python3 /opt/filterest-coding-agent/runner/coding_agent_runner.py --config /etc/filterest-coding-agent/site.json --check`.
   It checks the tools, pinned version, account and modes without a model request.
5. Install and start the reviewed systemd unit. Give the web process group access
   to the socket and set `FILTEREST_CODING_AGENT_SOCKET`,
   `FILTEREST_CODING_AGENT_SITE_ID` and `FILTEREST_SITE_ASSISTANT_BASE_URL`. For a
   container, mount the socket's directory, use the host-visible web UID and
   matching group, and give the container and the host the same
   `FILTEREST_CODING_AGENT_UPLOAD_DIR`, matching the runner's explicit
   `upload_dir`, so attached images are readable by the runner. Use a real
   directory with no symlink components, writable by the web account and
   readable by the runner. Keep production uploads outside the runner's private
   state directory, which the service keeps inaccessible to the web account.
6. Verify the administrator availability GET, non-administrator rejection and a
   read-only assistant question before enabling approvals.

### Ordinary Docker installation

The standard Docker stack has an optional connection to the separate runner
above. Add all five settings to the installation's protected `keys/docker.env`:

```dotenv
FILTEREST_CODING_AGENT_SOCKET_DIR=/run/filterest-coding-agent-example
FILTEREST_CODING_AGENT_IPC_GID=12345
FILTEREST_CODING_AGENT_SITE_ID=example.invalid
FILTEREST_SITE_ASSISTANT_BASE_URL=http://127.0.0.1:18123
FILTEREST_CODING_AGENT_UPLOAD_DIR=/var/lib/filterest-coding-agent-uploads-example
```

Use the actual runner's numeric IPC group, site identity and host-reachable
application URL; the port above is illustrative. The callback is an HTTP
loopback or HTTPS origin, without credentials, path, query or fragment.
The runner socket must be named `runner.sock` in the selected host directory.
The container sees that directory read-only at `/run/filterest-coding-agent`;
mounting the directory keeps a replaced socket visible after a runner restart.
The supplementary IPC group permits connecting to it. The attachment directory
is writable and has the **same absolute path on the host and in the container**;
set the runner's `upload_dir` to that exact path too.

Create dedicated socket and attachment directories before setup. Both must be
real directories without symbolic-link components, outside the installation,
and neither may contain the other. The upload mount cannot cover application,
system or socket paths. Keep runner credentials and private jobs in a different
directory that is never mounted into the web container. Setup validates paths
and settings; it does not create runner users, change their permissions, start
a runner, or prove that its socket accepts this web process.

Run `./filterest docker setup` and `./filterest docker start` as the intended
non-root installation owner. Setup builds the web image with **that owner's
UID and primary GID**; give the runner that host-visible UID in
`allowed_web_uids`, keep its own account distinct, and make the attachment
directory writable by the web user and readable by the runner. Retain the
availability, administrator-boundary and read-only question checks above;
also test an attached image and reconnect after a runner restart.

All five values are required together. Leaving all absent preserves the
ordinary installation. To disconnect an existing connection, stop the stack,
remove those five values, run setup and start again. Setup owns the internal
`FILTEREST_ASSISTANT_FILE` selector; do not edit it or supply private Compose
fragments. Ordinary `./filterest update` retains the settings and maintained
fragment. Its backups contain the settings references, **not** the external
socket, runner credentials, jobs or temporary attachments. Manage and recover
the runner independently; a restored installation must reconnect to it before
the assistant becomes available.

The offline conformance command accepts the same five non-secret parameters
and compares those exact external mounts without reading them. Its existing
exclusions still apply: it does not establish host UID/group permissions,
runner readiness or backup completeness. Maintenance-manager credentials and
its trusted peer setting remain in `keys/filterest_runtime/runtime_environment.env`,
which the application already loads; this connection does not expose them to
the runner or broaden manager access.

The earlier isolated source-copy variant (detached Git worktrees and fixed
maintenance actions) was removed. A runner configuration that still names
`repository`, `source_revision` or `maintenance_actions` is refused with a message
saying so.

## Requests, recovery and evidence

POST accepts `dataset`, `query`, `mode`, optional `lang`, `messages` and image
tokens, and a UUID `request_id`, and returns HTTP 202 with `job_id`, `status` and
`mode`. Polling uses the same administrator-only GET with `dataset` and `job_id`.
Only the initiating administrator can read that job, for the original dataset.
Repeating the same ID and request is idempotent; changed content is rejected.
One job runs at a time per runner.

The chat saves the job ID and mode before dispatch and resumes status polling
after navigation or reload, without resubmitting the prompt, and names the mode
in the resumed waiting message. Closing the chat stops polling; the job
continues. A web application restart leaves the runner and its jobs intact.
Stopping or restarting the runner ends a running job's whole process group and
marks unfinished jobs `interrupted`; it never silently restarts one.

Private job folders contain the request, prompt, execution log, answer and
status. Keep them restricted to the runner and operator, and apply an explicit
retention policy after jobs finish. Timeouts end the entire command process
group, including spawned tools.

Tests use disposable Git checkouts, fake CLIs and a fake site, including real
Unix-socket dispatch and `./ctl agent` start/stop. They verify the policy,
administrator and owner boundaries, the mode rules, the environment allowlist,
restart receipts, one writer and timeouts without making model requests. They
do not claim a paid-model run or any production deployment.
