# Queen — Persistent Session Agent System

## Core Idea

Two (or more) AI agents run as **persistent CLI sessions**.
The backend family is chosen by runtime flags or current configuration, not by this document.
Each agent maintains its own rich context (tool calls, outputs, reasoning) across turns.
Inter-agent communication passes **only the written message** — not CLI history or reasoning.

This mirrors two humans chatting: each remembers their own full day, but only writes
a short message to the other.

## Current Scope (2026-03-31)

- The current public Queen CLI surface is `./queen run`, `./queen status`, and `./queen chat`.
- The current browser surface is admin `queen_chat`, which provides transcript viewing, managed local sessions, and browser-authored human resume messages.
- Queen may keep work inside its own supervisor loop, delegate to Heisenberg, or pause explicitly for human input.
- `--max-turns` is the primary hard stop for one run; treat it as the main runtime guard before inventing deeper loop control machinery.

## Not Building Right Now

- No new GitNexus-specific diagnosis layer inside Queen just because it is available elsewhere in the repo.
- No new investment in the retired Queen1 `single` / `loop` line unless a concrete migration need appears.
- No proactive loop-mode expansion for its own sake while the current multi-turn runtime already handles the practical workflow.
- If a future gap appears, scope it from a real operational pain point in the current runtime, not from historical Queen1 roadmap momentum.

## UI Convergence With RegFetch

RegFetch and Queen should move toward one shared **chat shell** design, not one shared
runtime.

### Shared UX Contract

- One bottom composer is the only writing field in the view.
- The left rail owns conversation/session selection plus an explicit `New Conversation` action.
- The center rail is reserved for the transcript itself.
- The right rail is optional context: helpful metadata, but not a second place to write.
- User messages should be slightly offset right; assistant/system messages stay left.

### Reusable Layer

The reusable layer should stay presentational:
- conversation list / left rail
- transcript shell and message bubbles
- single bottom composer with mode-specific labels
- header chips, empty states, and lightweight session metadata cards

### Product-Specific Controllers

The domain controllers should remain separate:
- RegFetch is a history-first chat whose session list, drafts, and `/chat` request flow live inside the RegFetch app.
- Queen is a managed-session orchestrator whose browser view must respect transcript replay, pause/resume state, human handoff, and CLI/browser parity.

### Queen-Specific Rule

A selected completed Queen transcript should not pretend to be a writable live process.
The correct UX is "continue from this conversation" by starting a new managed session
from the selected transcript context.

### Extraction Strategy

If shared components are extracted later, the target split is:
- shared chat-shell primitives in reusable frontend UI code
- app-specific state machines in RegFetch and Queen

Prefer this order:
1. Stabilize the shared UX contract in both products.
2. Extract small UI primitives and helper logic.
3. Leave runtime/session semantics separate unless a real operational need appears.

## Thread-First Queen Direction

The next major UX step for Queen should be to move from a **run-first** browser
model to a **thread-first** user model.

### Current State

- The browser currently selects either a transcript run or a managed session.
- A transcript file under `.queen/transcripts/` is the primary readable artifact.
- A managed session manifest under `.queen/session_registry/` is the primary live-control artifact.
- Each managed session also has separate runtime artifacts:
  - `.queen/session_inputs/queen_session_<id>_human_inbox.jsonl`
  - `.queen/session_state/queen_session_<id>_state.json`
  - `.queen/session_logs/queen_session_<id>.log`
- This is safe and debuggable, but it exposes Queen's internal orchestration model
  too directly to the human.

### Target User Model

To the human, Queen should feel like one continuing conversation thread:
- one thread can contain many human messages over time
- one thread can contain multiple Queen runs or managed-session resumptions
- continuing an older conversation should feel like appending to the same thread,
  not starting a visibly unrelated new conversation

### Internal Model Split

Keep the internal runtime layered instead of flattening everything into one object:

- `thread`
  - the user-facing conversation container
  - owns the public message history the human expects to continue
- `run`
  - one concrete Queen execution attempt inside a thread
  - may be a fresh kickoff, a browser continuation, or a resumed managed session
- `debug transcript`
  - the raw Queen / Worker / human event log for one run
  - remains available for inspection, but should not be the default main chat view

### UX Contract

Default Queen chat view:
- left rail = threads
- center = thread transcript in public conversation form
- right rail = optional thread/run/session context

Debug mode:
- show raw run transcript with Queen -> Worker -> Queen turn structure
- expose run boundaries, managed session state, and process-level metadata
- keep this as a secondary lane or expandable inspector, not the main chat surface

### Public vs Internal Messages

The public thread should prefer human-readable Queen messages:
- human kickoff
- Queen answer
- human follow-up
- Queen answer

Worker messages should normally stay out of the default public lane unless the user
explicitly opens debug detail. This matches how mainstream AI chats feel continuous
even when internal tool calls or substeps exist.

### Continuation Semantics

When the user continues a completed Queen conversation:
- the public thread receives a new human message
- backend starts a new run under the same thread
- that run may create a fresh managed session and transcript file
- the UI still presents the result as the next answer in the same thread

In other words:
- same user thread
- possibly new internal run
- possibly new managed session

This preserves honest runtime boundaries without forcing the user to think in
"session vs transcript" terms.

### Direct Queen Answers

Not every thread message should trigger a Queen -> Worker -> Queen cycle.

If Queen can answer from existing in-session context without new investigation,
commands, file reads, edits, or verification, Queen should be allowed to:
- answer directly
- stop the run immediately
- append one public Queen answer to the thread

That rule should be general for lightweight follow-ups, not limited to any single
example such as "repeat the previous answer".

### Migration Path

1. Introduce a thread manifest/registry that can point to one or more runs.
2. Keep current run transcripts and managed-session manifests as the execution substrate.
3. Add a thread timeline builder that derives the public conversation view from one or more runs.
4. Move raw run transcripts behind an expandable debug lane.
5. Update CLI/browser flows so "continue conversation" appends to a thread while still launching a new run internally when needed.

### Biggest Migration Constraints

- Current browser state is `selectedRun` / `selectedSession`; no `selectedThread` exists yet.
- Current CLI/browser handoff is built around session ids and transcript filenames.
- Current continuation works by prompt synthesis from transcript excerpts, not from structured thread state.
- Current run transcript is the raw internal event log, so there is no canonical public-thread message store yet.

### Why This Direction

This gets Queen closer to the feel of modern conversation-first AI products without
throwing away the current debug-friendly orchestration substrate.

The human should think in threads.
Queen should think in runs.
Debugging should think in raw transcripts.

### Delivered First Slice (2026-04-01)

The first thread-first slice is now implemented:
- `.queen/thread_registry/queen_thread_<id>.json` manifests group one or more run filenames under one logical Queen conversation.
- Browser-managed session starts can reuse an existing thread id or seed a new thread from the selected transcript being continued.
- The browser left rail now has a user-facing `Conversation Threads` list above raw `Debug Runs`.
- Selecting a thread opens its active managed session when one exists, otherwise the latest run transcript for that thread.

This is intentionally only the first slice:
- the center transcript still shows the raw run transcript
- public thread timelines are not built yet
- raw Queen/Worker turns remain the default readable transcript artifact for now

So the current state is:
- thread-first selection
- run-first transcript rendering
- debug-friendly runtime artifacts kept intact underneath

### Delivered Second Slice (2026-04-01)

The next thread-first UX slice is now implemented:
- Selecting a `Conversation Threads` item renders a public `human -> queen` conversation lane across that thread's runs.
- Continuation runs no longer expose the full synthesized continuation prompt as the visible human message in the public lane; the UI extracts and shows the actual new human follow-up instead.
- Queen `AWAITING_HUMAN` prompts and final `[DONE]` answers remain visible in the public lane.
- Raw run transcripts still exist as the debug artifact and remain directly inspectable via `Debug Runs`.

So the current state is now:
- thread-first selection
- public thread timeline for the main conversation view
- raw run transcript still available as the debug lane / artifact

### Delivered Third Slice (2026-04-01)

The next continuity / polish slice is now implemented:
- The browser restores the selected thread, session, run, and current composer draft fields after `F5` via localStorage instead of always resetting to an empty idle view.
- The main transcript header now shows an explicit processing indicator while Queen is starting, running, resuming, or consuming the latest human reply.
- Browser-authored human messages appear optimistically in the public thread lane immediately after send, and multiline Queen replies preserve meaningful line breaks in that lane.

So the current state is now:
- thread-first selection
- refresh-resilient browser workspace continuity
- public thread timeline for the main conversation view
- raw run transcript still available as the debug lane / artifact

### Delivered Fourth Slice (2026-04-01)

The next inspectability slice is now implemented:
- The thread timeline keeps its default user-facing `human -> queen` view so normal browser use still reads like one conversation.
- The main thread header now exposes a `Show internal turns` toggle that reveals worker / Heisenberg turns and internal Queen turns inline when deeper orchestration context matters.
- This toggle is local browser state and is persisted through the Queen chat localStorage workspace restore, so refresh does not silently discard the chosen debug depth.

So the current state is now:
- thread-first selection
- default public thread timeline for the main conversation view
- optional internal-turn reveal in the same selected conversation
- raw run transcript still available as the lower-level debug artifact

### Delivered Fifth Slice (2026-04-01)

The next browser reliability slice is now implemented:
- When a selected managed Queen session reaches `completed`, `failed`, or `stopped`, the browser now reloads the authoritative transcript snapshot before it detaches live follow.
- This closes the race where the terminal session-status SSE event could arrive before the final transcript append event and leave the visible thread lane stranded on the previous worker/internal turn.

So the current state is now:
- thread-first selection
- default public thread timeline for the main conversation view
- terminal-session completion now reconciles against the final transcript snapshot before browser follow detaches
- raw run transcript still available as the lower-level debug artifact

### Delivered Sixth Slice (2026-04-01)

The next timestamp polish slice is now implemented:
- Timezone-aware Queen timestamps now render in `Europe/Helsinki` local time in both the browser `queen_chat` workspace and the terminal `./queen chat` transcript viewer.
- That means winter and summer time changes are handled automatically when the source timestamp includes `Z` or an explicit UTC offset.
- Existing timezone-less `YYYY-MM-DD HH:mm:ss` values are left unchanged instead of being guessed into a zone they did not declare.

So the current state is now:
- thread-first selection
- default public thread timeline for the main conversation view
- terminal-session completion now reconciles against the final transcript snapshot before browser follow detaches
- Queen timestamps with real timezone data now display in Finland local time with DST handling
- raw run transcript still available as the lower-level debug artifact

### Delivered Seventh Slice (2026-04-01)

The next browser progress / layout slice is now implemented:
- Managed Queen sessions now persist compact system-generated progress fields (`progress_phase`, `progress_tone`, `progress_note`) that are distinct from `status_reason`.
- The browser `queen_chat` workspace now renders those progress notes in the right-side detail rail so the human can see that Queen has started, delegated to Heisenberg, is reviewing the latest worker result, is awaiting a human reply, or has completed.
- The old transcript-header summary lines now live in a wider right-side `Conversation Overview` panel, which keeps the selected conversation summary, transcript-mode chips, terminal handoff, and live orchestration status visible together without crowding the main transcript lane.
- The redundant transcript header box is gone, and the lower composer now uses a tighter right-side action rail for `Task ID`, `Max turns`, and send/cancel actions instead of splitting those controls above and below the textarea.

So the current state is now:
- thread-first selection
- default public thread timeline for the main conversation view
- terminal-session completion now reconciles against the final transcript snapshot before browser follow detaches
- Queen timestamps with real timezone data now display in Finland local time with DST handling
- the right rail now doubles as a live managed-session overview and progress surface
- raw run transcript still available as the lower-level debug artifact

### Delivered Eighth Slice (2026-04-01)

The next runtime resilience slice is now implemented:
- The default Queen `codex` backend soft timeout is now `2400` seconds instead of `600`.
- The default hard timeout remains slightly above the soft timeout so Queen still has a small forced-stop guardrail after the wrap-up interrupt path starts.
- This specifically targets long multi-iteration worker turns where the agent is still doing useful private work but had previously been cut off before it could hand a verified result back to Queen.

So the current state is now:
- thread-first selection
- default public thread timeline for the main conversation view
- terminal-session completion now reconciles against the final transcript snapshot before browser follow detaches
- Queen timestamps with real timezone data now display in Finland local time with DST handling
- the right rail now doubles as a live managed-session overview and progress surface
- Codex-backed Queen turns now have a much longer default soft-timeout window for long-running implementation work
- raw run transcript still available as the lower-level debug artifact

### Delivered Ninth Slice (2026-04-02)

The next runtime resilience slice is now implemented:
- If a `codex`-backed Queen turn hits the soft timeout and exits without writing a usable last message to Queen's output file, Queen now launches one short forced wrap-up `codex exec resume ...` turn on the same session instead of giving up immediately.
- If the interrupted turn already wrote a valid last message after the soft-timeout `SIGINT`, Queen accepts that message directly and skips the extra wrap-up pass.
- The new unit coverage locks both paths in place so future timeout tuning does not silently regress back to "SIGINT only".

So the current state is now:
- thread-first selection
- default public thread timeline for the main conversation view
- terminal-session completion now reconciles against the final transcript snapshot before browser follow detaches
- Queen timestamps with real timezone data now display in Finland local time with DST handling
- the right rail now doubles as a live managed-session overview and progress surface
- Codex-backed Queen turns now have a much longer default soft-timeout window for long-running implementation work
- soft-timeout worker turns can now self-report one final wrap-up on the same Codex session instead of disappearing when the first interrupted turn fails to emit a last message
- raw run transcript still available as the lower-level debug artifact

### Delivered Tenth Slice (2026-04-02)

The next internal resilience / maintainability slice is now implemented:
- The Queen CLI backends no longer each carry their own near-duplicate subprocess timeout/interrupt/kill runner.
- Claude and Codex now share one common process runner and tail logger inside `cli_backend.py`.
- Backend-specific behavior stays in separate hooks: Claude still parses JSON output directly, while Codex still owns output-file capture and the soft-timeout wrap-up-resume fallback.

So the current state is now:
- thread-first selection
- default public thread timeline for the main conversation view
- terminal-session completion now reconciles against the final transcript snapshot before browser follow detaches
- Queen timestamps with real timezone data now display in Finland local time with DST handling
- the right rail now doubles as a live managed-session overview and progress surface
- Codex-backed Queen turns now have a much longer default soft-timeout window for long-running implementation work
- soft-timeout worker turns can now self-report one final wrap-up on the same Codex session instead of disappearing when the first interrupted turn fails to emit a last message
- the shared Claude/Codex subprocess timeout path is now simpler to change safely because the process runner lives in one place
- raw run transcript still available as the lower-level debug artifact

### Delivered Eleventh Slice (2026-04-02)

The next observability / stability slice is now implemented:
- Managed-session snapshots now expose a dedicated `progress_updated_at` timestamp instead of forcing the browser to infer progress freshness only from the broader session `updated_at`.
- Managed-session snapshots now also expose the current `pending_turn` metadata from runtime state, including which agent turn is in flight, when it started, and the preview of the message that triggered it.
- The browser `queen_chat` right rail uses that telemetry to show the current in-flight Queen/Heisenberg turn during long runs, making it easier to distinguish "still working normally" from "maybe actually stalled".

So the current state is now:
- thread-first selection
- default public thread timeline for the main conversation view
- terminal-session completion now reconciles against the final transcript snapshot before browser follow detaches
- Queen timestamps with real timezone data now display in Finland local time with DST handling
- the right rail now doubles as a live managed-session overview and progress surface
- long-running managed sessions now surface the active in-flight agent turn and the exact progress-checkpoint timestamp in the browser
- Codex-backed Queen turns now have a much longer default soft-timeout window for long-running implementation work
- soft-timeout worker turns can now self-report one final wrap-up on the same Codex session instead of disappearing when the first interrupted turn fails to emit a last message
- the shared Claude/Codex subprocess timeout path is now simpler to change safely because the process runner lives in one place
- direct non-managed Queen runs can now auto-follow in the browser when the selected run is the newest run or the latest run inside a selected thread, instead of remaining a dead snapshot until the next manual refresh
- transcript SSE now emits explicit heartbeat events, so the browser can show a live heartbeat and latest transcript-entry timestamp for direct runs even during long silent worker turns
- the direct-run right rail is still transcript and SSE based rather than true process telemetry, so it should say likely or watching live instead of claiming that Heisenberg is definitely active
- the left sidebar now refreshes runs and managed sessions quietly in the background so newly launched Queen runs appear in the browser without manual refresh clicks
- raw run transcript still available as the lower-level debug artifact

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  ConversationLoop (conversation_loop.py)            │
│  - Orchestrates turn-taking between agents          │
│  - Passes only final text between agents            │
│  - Archives messages to bee_messages API            │
│  - Enforces rate limits and safety stops            │
│                                                     │
│  ┌───────────────┐         ┌───────────────┐        │
│  │ PersistentAgent│ ←msg→  │ PersistentAgent│       │
│  │ "queen"       │         │ "heisenberg"  │        │
│  │               │         │               │        │
│  │ CLIBackend    │         │ CLIBackend    │        │
│  │ (configured)  │         │ (configured)  │        │
│  └───────────────┘         └───────────────┘        │
│         │                         │                  │
│    own session               own session             │
│    (full context)            (full context)           │
└─────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `cli_backend.py` | Abstract interface + backend-family implementations |
| `persistent_agent.py` | Stateful agent wrapping a CLIBackend session |
| `conversation_loop.py` | Turn-taking orchestration, message-only passing |
| `message_bus.py` | Portable bee-messages API client used for optional task archiving |
| `main.py` | CLI entrypoint |
| `__main__.py` | Package runner |

## CLI

```bash
# Use current configured families
./queen run --task-id 738 "Investigate the login bug"

# Use explicit families for this one run
./queen run --task-id 738 --queen-family claude --worker-family codex "Fix the CSS"
```

`app/server_tools/queen/main.py` plus any explicit CLI flags are the source of truth for the active families. When no explicit `--queen-family` / `--worker-family` flags are passed, Queen follows the current public worker default (or `WORKER_AGENT_BACKEND` env override). This plan should not be used to infer a permanently preferred backend.

### Operator Note: Early Silence Is Normal

When `./queen run` starts a fresh persistent session, the terminal may stay quiet for a while before the first queen reply is written. This is normal and does **not** by itself mean the process is stuck.

Before killing a seemingly quiet run, check all three signals together:
- the `queen run` process is still alive
- the transcript file under `.queen/transcripts/` is still growing or its timestamp is advancing
- ticket comments / worker output / later transcript turns are appearing, even if slowly

Do not treat the first 3-5 minutes of silence as a failure if the backend process is still running. Prefer patience and transcript inspection over restarting. Consider the run genuinely stalled only after repeated checks show **no** process progress and **no** transcript growth for several minutes.

## Current `.queen` Runtime Contract

The current Beehive / Queen v3 runtime uses a smaller active subset of `.queen/`
than the historical Queen1/Queen2 experiments.

Active paths:
- `.queen/transcripts/` plus per-run `*.runtime.json` sidecars are the direct-run truth for transcript replay, browser live follow, and direct-run process state.
- `.queen/session_registry/`, `.queen/session_state/`, `.queen/session_inputs/`, and `.queen/session_logs/` are the managed-session contract used by CLI/browser resume flows.
- `.queen/thread_registry/` is the browser conversation-thread index.
- `.queen/run_guards/` is the direct-run duplicate-launch guard.

Legacy or non-authoritative paths:
- `.queen/loop_prompts/` and `.queen/state.json` belong to `queen1_archived`.
- `.queen/queen_l3_preflight_prompt.md` is historical prompt residue, not part of the live runtime contract.
- `.queen/runs/` is no longer part of the active Beehive browser/runtime path and should not be used as the source of truth for new liveness features.

When adding observability or recovery features, prefer extending the existing
runtime sidecar / managed-session state contract instead of introducing another
parallel file-based signal under `.queen/`.

## Experimental Single-Worker Autopilot

Queen v3 now also has an experimental `./queen run --autopilot` mode for
cases where the extra `queen -> worker -> queen` review turn is more overhead
than value.

This mode keeps one persistent worker session alive with rich internal context
and lets application logic auto-send a short continue message between turns,
closer to the "human presses 3 to continue" pattern than the classic two-agent
supervisor loop.

First-slice constraints:
- It is currently a direct-run prototype, not the default Queen path.
- It stops on `[DONE]`, `[AWAITING_HUMAN]`, or `MAX_TURNS`.
- It preserves direct-run transcript and runtime-sidecar observability instead
  of introducing a parallel browser contract.
- Long in-flight autopilot turns now refresh the runtime-sidecar heartbeat every
  20 seconds so browser follow can distinguish a still-running worker turn from
  a totally stale snapshot.
- It does not yet support managed-session restart recovery via
  `--resume-managed-session`.

## History

Queen went through three iterations:
- **Queen v1** (retired): deterministic dispatch + worker-agent one-shot
- **Queen v2** (retired): bee-messages-based stateless agent turns
- **Queen v3** (current): persistent session architecture — won benchmark (89.5 vs 84/76/69.5)

## Phases

- [x] Phase 1: CLI backend abstraction + persistent agent + conversation loop
- [x] Phase 2: Live smoke test with real sessions (ticket #739, image upload)
- [ ] Phase 3: Context health monitoring (detect when session is filling up)
- [ ] Phase 4: Session save/resume across process restarts
  - [x] Managed-session restart resume from the `awaiting_human` boundary, preserving private Queen/Heisenberg CLI session ids and the committed human-inbox offset so a browser reply can relaunch the same internal contexts after backend restart
  - [x] Worker-turn crash journaling that preserves Queen's last safe checkpoint, rehydrates a dead in-flight worker turn as a recovery handoff, and resumes with a fresh worker session instead of reusing an ambiguous half-completed worker turn
- [ ] Phase 5: Multi-worker topology (>2 agents)
