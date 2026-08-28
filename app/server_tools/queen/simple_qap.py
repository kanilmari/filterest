# simple_qap.py
# Structured Queen Autopilot (QAP) helpers and standalone runner for Filterest.
# Bridges Queen autopilot prompts with machine-parsed JSON handoff blocks.
# Exists so both the standalone script and the integrated Queen autopilot can
# share one continuation contract, transcript shape, and parsing logic.
#
# Usage:
#   python -m server_tools.queen.simple_qap "Fix the login bug" --task-id 802
#   python -m server_tools.queen.simple_qap "..." --max-turns 5
#
# Chat visibility:
#   ./queen chat --list          — shows this run alongside normal Queen runs
#   ./queen chat <filename>      — renders the turn-by-turn transcript

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..lib.easelect_private_paths import resolve_embedded_project_root

_CANONICAL_FILTEREST_ROOT = Path(__file__).resolve().parent.parent.parent
_PROJECT_ROOT = resolve_embedded_project_root(_CANONICAL_FILTEREST_ROOT)
_TRANSCRIPT_DIR = _PROJECT_ROOT / ".queen" / "transcripts"
QAP_CONTROLLER_ROLE = "controller"
QAP_CONTROLLER_AGENT_NAME = "QAP controller"
QAP_CONTROLLER_DEBUG_TEXT_KEY = "debug_full_text"
QAP_SUMMARY_CHIPS_KEY = "summary_chips"
QAP_SUMMARY_NOTE_KEY = "summary_note"
QAP_VISIBLE_CONTROLLER_STEP_LIMIT = 220
QAP_PACING_GUIDANCE_LINES = [
    "It is okay to complete the work across multiple autopilot turns in this same persistent session.",
    "Do not force the whole ticket into a single reply when a smaller reliable work stretch is better.",
    "Prefer one coherent implementation or verification stretch per turn.",
    "At the end of each non-final turn, report what you completed, what remains, and the next concrete step.",
    "Use [DONE] only when the full requested scope is complete and verified as far as practical.",
    "Use [AWAITING_HUMAN] only for a real human decision or approval blocker.",
]
QAP_PHASE_WORKFLOW = {
    1: "Phase 1: Orient",
    2: "Phase 2: Plan & Delegate",
    3: "Phase 3: Work Verbosely",
    4: "Phase 4: Verify",
    5: "Phase 5: Collect Knowledge",
    6: "Phase 6: Close the Loop",
}
QAP_DEFAULT_PHASE_PACING = "balanced"


@dataclass(frozen=True)
class QAPPacingProfile:
    """One QAP phase-pacing preset used to shape reply chunking."""

    key: str
    phase_checkpoints: tuple[int, ...]
    summary: str
    target_reply_hint: str


QAP_PHASE_PACING_PROFILES = {
    "strict_test": QAPPacingProfile(
        key="strict_test",
        phase_checkpoints=(2, 3, 4, 5, 6),
        summary="Use one short phase stretch per reply for pacing experiments.",
        target_reply_hint="Expect roughly five or six replies for a normal successful task.",
    ),
    "balanced": QAPPacingProfile(
        key="balanced",
        phase_checkpoints=(3, 6),
        summary="Use broader chunks when practical: early work through Phase 3, then verification and close-out through Phase 6.",
        target_reply_hint="Many medium tasks should finish in about two replies, while harder tasks may still take more.",
    ),
    "compact": QAPPacingProfile(
        key="compact",
        phase_checkpoints=(6,),
        summary="Use the fewest safe replies practical; very small tasks may complete all six phases in one strong verified reply.",
        target_reply_hint="Small tasks may finish in one reply when the evidence is already straightforward.",
    ),
}

# ---------------------------------------------------------------------------
# Handoff schema
# ---------------------------------------------------------------------------

@dataclass
class HandoffJSON:
    """Structured handoff block that the agent appends to every response."""

    tiketti_id: Optional[int]
    tyovaihe_alku: str
    tyovaihe_loppu: str
    tavoite: str
    mita_tehtiin: str
    ehdotus_jatkoon: str
    koodin_tila_vastaa_tavoitetta: bool
    evidence: list[str] = field(default_factory=list)
    voidaanko_jatkaa: bool = True
    miksi_ei_voida_jatkaa: Optional[str] = None

    @classmethod
    def from_dict(cls, d: dict) -> "HandoffJSON":
        return cls(
            tiketti_id=d.get("tiketti_id"),
            tyovaihe_alku=str(d.get("tyovaihe_alku", "")),
            tyovaihe_loppu=str(d.get("tyovaihe_loppu", "")),
            tavoite=str(d.get("tavoite", "")),
            mita_tehtiin=str(d.get("mita_tehtiin", "")),
            ehdotus_jatkoon=str(d.get("ehdotus_jatkoon", "")),
            koodin_tila_vastaa_tavoitetta=bool(d.get("koodin_tila_vastaa_tavoitetta", False)),
            evidence=list(d.get("evidence") or []),
            voidaanko_jatkaa=bool(d.get("voidaanko_jatkaa", True)),
            miksi_ei_voida_jatkaa=d.get("miksi_ei_voida_jatkaa") or None,
        )


def parse_handoff(text: str) -> Optional[HandoffJSON]:
    """Extract the last ```json ... ``` block from agent output and parse it as HandoffJSON."""
    matches = re.findall(r"```json\s*([\s\S]*?)```", text)
    if not matches:
        return None
    raw = matches[-1].strip()
    try:
        d = json.loads(raw)
        if not isinstance(d, dict):
            return None
        return HandoffJSON.from_dict(d)
    except json.JSONDecodeError:
        return None


def extract_phase_number(label: str) -> Optional[int]:
    """Return the numeric phase from labels like `Phase 3: Work Verbosely`."""
    match = re.search(r"\bphase\s*(\d+)\b", str(label or ""), flags=re.IGNORECASE)
    if match is None:
        return None
    return int(match.group(1))


def get_phase_label(phase_number: int) -> str:
    """Return the canonical QAP workflow label for one numbered phase."""
    return QAP_PHASE_WORKFLOW.get(phase_number, f"Phase {phase_number}")


def list_qap_phase_pacing_keys() -> list[str]:
    """Return the allowed QAP pacing-profile keys in stable order."""
    return list(QAP_PHASE_PACING_PROFILES)


def resolve_qap_phase_pacing(phase_pacing: str = QAP_DEFAULT_PHASE_PACING) -> QAPPacingProfile:
    """Return one normalized QAP pacing profile from a CLI/config value."""
    normalized = str(phase_pacing or QAP_DEFAULT_PHASE_PACING).strip().lower().replace("-", "_")
    profile = QAP_PHASE_PACING_PROFILES.get(normalized)
    if profile is None:
        allowed = ", ".join(list_qap_phase_pacing_keys())
        raise ValueError(f"Unsupported QAP phase pacing profile '{phase_pacing}'. Allowed values: {allowed}")
    return profile


def _format_phase_checkpoint_range(checkpoints: tuple[int, ...]) -> str:
    """Render checkpoint labels like `Phase 3 -> Phase 6` for humans."""
    return " -> ".join(get_phase_label(checkpoint) for checkpoint in checkpoints)


def get_qap_phase_limit(previous_phase_end: str, phase_pacing: str = QAP_DEFAULT_PHASE_PACING) -> str:
    """Return the next allowed phase end label for one pacing profile."""
    profile = resolve_qap_phase_pacing(phase_pacing)
    previous_phase_number = extract_phase_number(previous_phase_end)
    if previous_phase_number is None:
        return get_phase_label(profile.phase_checkpoints[0])
    for checkpoint in profile.phase_checkpoints:
        if checkpoint > previous_phase_number:
            return get_phase_label(checkpoint)
    return get_phase_label(max(QAP_PHASE_WORKFLOW))


def _truncate_controller_step(step: str, *, limit: int = QAP_VISIBLE_CONTROLLER_STEP_LIMIT) -> str:
    """Normalize and shorten one next-step summary for transcript visibility."""
    normalized = " ".join(str(step or "").split()).strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[: max(0, limit - 3)].rstrip() + "..."


def _build_summary_chip(label: str, tone: str = "unknown") -> dict[str, str]:
    """Return one compact transcript-summary chip payload."""
    normalized_label = " ".join(str(label or "").split()).strip()
    normalized_tone = " ".join(str(tone or "unknown").split()).strip() or "unknown"
    return {"label": normalized_label, "tone": normalized_tone}


def _build_qap_phase_window_label(start_label: str, end_label: str) -> str:
    """Render a compact `Phases 1 -> 3` label from full QAP phase names."""
    start_number = extract_phase_number(start_label)
    end_number = extract_phase_number(end_label)
    if start_number is not None and end_number is not None:
        if start_number == end_number:
            return f"Phase {start_number}"
        return f"Phases {start_number} -> {end_number}"
    normalized_end = " ".join(str(end_label or "").split()).strip()
    if normalized_end:
        return normalized_end
    return " ".join(str(start_label or "").split()).strip()


def build_qap_initial_transcript_message(
    phase_pacing: str = QAP_DEFAULT_PHASE_PACING,
) -> str:
    """Build a short controller summary for human-facing transcript viewers."""
    profile = resolve_qap_phase_pacing(phase_pacing)
    return "\n".join([
        "Start from Phase 1: Orient.",
        f"End this reply no later than {get_qap_phase_limit('', profile.key)}.",
        f"Pacing: {profile.key}.",
    ])


def build_qap_initial_transcript_summary(
    phase_pacing: str = QAP_DEFAULT_PHASE_PACING,
) -> dict:
    """Build first-class transcript summary fields for the first controller message."""
    profile = resolve_qap_phase_pacing(phase_pacing)
    return {
        QAP_SUMMARY_CHIPS_KEY: [
            _build_summary_chip(
                _build_qap_phase_window_label("Phase 1: Orient", get_qap_phase_limit("", profile.key)),
            ),
            _build_summary_chip(f"Pacing: {profile.key}"),
        ],
        QAP_SUMMARY_NOTE_KEY: "",
    }


def build_qap_continue_transcript_message(
    suggested_next_step: str = "",
    previous_phase_end: str = "",
    phase_pacing: str = QAP_DEFAULT_PHASE_PACING,
) -> str:
    """Build a short follow-up controller summary for human-facing transcript viewers."""
    profile = resolve_qap_phase_pacing(phase_pacing)
    previous_phase_number = extract_phase_number(previous_phase_end)
    start_label = get_phase_label(previous_phase_number) if previous_phase_number is not None else "your current phase"
    next_phase_limit = get_qap_phase_limit(previous_phase_end, profile.key)
    next_step = _truncate_controller_step(suggested_next_step)

    lines = [
        f"Continue from {start_label}.",
        f"End this reply no later than {next_phase_limit}.",
        f"Pacing: {profile.key}.",
    ]
    if next_step:
        lines.append(f"Next: {next_step}")
    return "\n".join(lines)


def build_qap_continue_transcript_summary(
    suggested_next_step: str = "",
    previous_phase_end: str = "",
    phase_pacing: str = QAP_DEFAULT_PHASE_PACING,
) -> dict:
    """Build first-class transcript summary fields for a follow-up controller message."""
    profile = resolve_qap_phase_pacing(phase_pacing)
    previous_phase_number = extract_phase_number(previous_phase_end)
    start_label = get_phase_label(previous_phase_number) if previous_phase_number is not None else "Phase 1: Orient"
    next_phase_limit = get_qap_phase_limit(previous_phase_end, profile.key)
    next_step = _truncate_controller_step(suggested_next_step)
    return {
        QAP_SUMMARY_CHIPS_KEY: [
            _build_summary_chip(_build_qap_phase_window_label(start_label, next_phase_limit)),
            _build_summary_chip(f"Pacing: {profile.key}"),
        ],
        QAP_SUMMARY_NOTE_KEY: f"Next: {next_step}" if next_step else "",
    }


def build_qap_handoff_transcript_summary(handoff: HandoffJSON) -> dict:
    """Build first-class transcript summary fields from one structured QAP handoff."""
    chips = [
        _build_summary_chip(
            _build_qap_phase_window_label(handoff.tyovaihe_alku, handoff.tyovaihe_loppu),
        ),
    ]
    if handoff.koodin_tila_vastaa_tavoitetta:
        chips.append(_build_summary_chip("Goal met", "completed"))
    elif not handoff.voidaanko_jatkaa:
        chips.append(_build_summary_chip("Awaiting human", "awaiting_human"))
    else:
        chips.append(_build_summary_chip("In progress", "running"))

    next_step = _truncate_controller_step(handoff.ehdotus_jatkoon)
    return {
        QAP_SUMMARY_CHIPS_KEY: chips,
        QAP_SUMMARY_NOTE_KEY: f"Next: {next_step}" if next_step else "",
    }


# ---------------------------------------------------------------------------
# Claude CLI wrapper
# ---------------------------------------------------------------------------

def _call_claude(session_id: str, message: str, *, new_session: bool) -> tuple[str, str]:
    """Call `claude -p --output-format json` and return (result_text, session_id).

    Uses --session-id on the first turn (new_session=True) and --resume on
    subsequent turns. The session_id is preserved across all turns so the
    agent retains its full context.
    """
    cmd = ["claude", "-p", "--output-format", "json", "--dangerously-skip-permissions"]
    if new_session:
        cmd += ["--session-id", session_id]
    else:
        cmd += ["--resume", session_id]
    cmd.append(message)

    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=_PROJECT_ROOT)
    if proc.returncode != 0:
        raise RuntimeError(f"claude CLI exited {proc.returncode}: {proc.stderr.strip()}")

    data = json.loads(proc.stdout)
    if data.get("is_error"):
        raise RuntimeError(f"claude reported error: {data}")

    return str(data["result"]), str(data.get("session_id", session_id))


# ---------------------------------------------------------------------------
# Transcript writer
# ---------------------------------------------------------------------------

class _TranscriptWriter:
    """Appends JSONL entries in the format that ./queen chat can render."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._turn = 0
        path.parent.mkdir(parents=True, exist_ok=True)

    def write(
        self,
        role: str,
        agent: str,
        text: str,
        *,
        debug_full_text: str | None = None,
        summary_chips: list[dict] | None = None,
        summary_note: str = "",
    ) -> None:
        self._turn += 1
        entry = {
            "role": role,
            "agent": agent,
            "turn": self._turn,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "text": text,
        }
        if debug_full_text and debug_full_text != text:
            entry[QAP_CONTROLLER_DEBUG_TEXT_KEY] = debug_full_text
        if summary_chips is not None:
            entry[QAP_SUMMARY_CHIPS_KEY] = summary_chips
        if summary_note != "":
            entry[QAP_SUMMARY_NOTE_KEY] = summary_note
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# System-prompt suffix injected on the first turn only
# ---------------------------------------------------------------------------

HANDOFF_INSTRUCTIONS = """

---
At the end of your response, output a handoff block using this exact format:

```json
{
  "tiketti_id": null,
  "tyovaihe_alku": "Phase 1: Orient",
  "tyovaihe_loppu": "Phase 2: Plan & Delegate",
  "tavoite": "one-line description of the overall objective",
  "mita_tehtiin": "what was accomplished this turn",
  "ehdotus_jatkoon": "concrete next step if work is not finished",
  "koodin_tila_vastaa_tavoitetta": false,
  "evidence": ["go build OK", "test X passes", "curl /api/foo → 200"],
  "voidaanko_jatkaa": true,
  "miksi_ei_voida_jatkaa": null
}
```

Rules for the handoff block:
- Use the six-phase workflow exactly:
  - `Phase 1: Orient`
  - `Phase 2: Plan & Delegate`
  - `Phase 3: Work Verbosely`
  - `Phase 4: Verify`
  - `Phase 5: Collect Knowledge`
  - `Phase 6: Close the Loop`
- Follow the active phase pacing profile from the controller message. Do not end beyond the next allowed checkpoint that the controller names for this reply.
- For a fresh task, start from `Phase 1: Orient`.
- `koodin_tila_vastaa_tavoitetta`: true **only** when all objectives are met and verified with evidence.
- `evidence`: concrete proof — build output, test results, curl responses. Empty list if none yet.
- `voidaanko_jatkaa`: false **only** if genuinely blocked (missing info, unresolvable error, needs human decision).
- `miksi_ei_voida_jatkaa`: explain the blocker clearly; null when not blocked.
- If the task is complete, also include a plain `[DONE]` marker before the JSON block for transcript/tooling compatibility.
- If a human decision is required, also include a plain `[AWAITING_HUMAN]` marker before the JSON block for transcript/tooling compatibility.
- Do not output `[DONE]` before your handoff has reached `Phase 6: Close the Loop`.
- This block is machine-parsed. Do not omit it, do not add text after the closing fence.
"""


def build_qap_initial_message(prompt: str, phase_pacing: str = QAP_DEFAULT_PHASE_PACING) -> str:
    """Build the first-turn prompt for the structured QAP loop."""
    profile = resolve_qap_phase_pacing(phase_pacing)
    cleaned_prompt = prompt.strip()
    lines: list[str] = []
    if cleaned_prompt:
        lines.append(cleaned_prompt)
        lines.append("")
    lines.append("Autopilot pacing instructions:")
    lines.extend(f"- {line}" for line in QAP_PACING_GUIDANCE_LINES)
    lines.append(f"- QAP phase pacing profile for this run: `{profile.key}`.")
    lines.append(f"- {profile.summary}")
    lines.append(f"- Phase checkpoints for this profile: {_format_phase_checkpoint_range(profile.phase_checkpoints)}.")
    lines.append("- Use the six-phase workflow labels exactly as defined in the handoff schema.")
    lines.append(f"- {profile.target_reply_hint}")
    lines.append(f"- In your first reply, start at Phase 1: Orient and end no later than {get_qap_phase_limit('', profile.key)}.")
    lines.append("")
    lines.append(HANDOFF_INSTRUCTIONS.strip())
    return "\n".join(lines)


def build_qap_continue_message(
    suggested_next_step: str = "",
    previous_phase_end: str = "",
    phase_pacing: str = QAP_DEFAULT_PHASE_PACING,
) -> str:
    """Build the follow-up control message for the next QAP turn."""
    profile = resolve_qap_phase_pacing(phase_pacing)
    lines = [
        "Continue implementation from your existing session context.",
        *[f"- {line}" for line in QAP_PACING_GUIDANCE_LINES],
        f"- QAP phase pacing profile for this run: `{profile.key}`.",
        f"- {profile.summary}",
        f"- Phase checkpoints for this profile: {_format_phase_checkpoint_range(profile.phase_checkpoints)}.",
        "- Keep using the six-phase workflow labels from the handoff schema.",
        f"- {profile.target_reply_hint}",
    ]
    previous_phase_number = extract_phase_number(previous_phase_end)
    next_phase_limit = get_qap_phase_limit(previous_phase_end, profile.key)
    if previous_phase_number is not None:
        lines.append(
            f"- Your previous handoff ended at {get_phase_label(previous_phase_number)}."
        )
        lines.append(
            f"- Start this reply from that phase and end no later than {next_phase_limit}."
        )
    else:
        lines.append(f"- End this reply no later than {next_phase_limit}.")
    next_step = suggested_next_step.strip()
    if next_step:
        lines.append(f"- Prioritize this next step from your previous handoff: {next_step}")
    else:
        lines.append("- Otherwise keep working autonomously on the next concrete step and report concrete progress and evidence.")
    lines.append("- Do not output [DONE] unless your handoff ends at Phase 6: Close the Loop.")
    lines.append("- End this reply with the required JSON handoff block again.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main orchestration loop
# ---------------------------------------------------------------------------

def run_qap(
    prompt: str,
    *,
    task_id: Optional[int] = None,
    max_turns: int = 10,
    phase_pacing: str = QAP_DEFAULT_PHASE_PACING,
    transcript_path: Optional[Path] = None,
) -> None:
    """Run one simple_qap session: one agent, Python-controlled multi-turn loop."""
    session_id = str(uuid.uuid4())
    ts = time.strftime("%Y%m%d_%H%M%S")
    label = f"task_{task_id}" if task_id is not None else "manual"

    if transcript_path is None:
        transcript_path = _TRANSCRIPT_DIR / f"queen_run_{ts}_qap_{label}.jsonl"

    writer = _TranscriptWriter(transcript_path)

    print(f"simple_qap | session {session_id}")
    print(f"transcript  | {transcript_path}\n")

    # The continuation message, updated each turn.
    next_message: str = ""

    for turn in range(1, max_turns + 1):
        print(f"=== Turn {turn}/{max_turns} ===")

        if turn == 1:
            # First turn: inject handoff instructions into the prompt.
            # Transcript shows the clean human prompt without the instructions.
            send_message = build_qap_initial_message(prompt, phase_pacing)
            writer.write("human", "human", prompt)
            visible_controller_message = build_qap_initial_transcript_message(phase_pacing)
            controller_summary = build_qap_initial_transcript_summary(phase_pacing)
        else:
            send_message = next_message
            visible_controller_message = build_qap_continue_transcript_message(
                handoff.ehdotus_jatkoon,
                handoff.tyovaihe_loppu,
                phase_pacing,
            )
            controller_summary = build_qap_continue_transcript_summary(
                handoff.ehdotus_jatkoon,
                handoff.tyovaihe_loppu,
                phase_pacing,
            )
        writer.write(
            QAP_CONTROLLER_ROLE,
            QAP_CONTROLLER_AGENT_NAME,
            visible_controller_message,
            debug_full_text=send_message,
            summary_chips=controller_summary.get(QAP_SUMMARY_CHIPS_KEY),
            summary_note=str(controller_summary.get(QAP_SUMMARY_NOTE_KEY, "")),
        )

        try:
            result, session_id = _call_claude(session_id, send_message, new_session=(turn == 1))
        except RuntimeError as exc:
            print(f"Error calling Claude: {exc}", file=sys.stderr)
            writer.write("queen", "heisenberg", f"[ERROR] {exc}")
            sys.exit(1)

        # Parse handoff
        handoff = parse_handoff(result)
        handoff_summary = build_qap_handoff_transcript_summary(handoff) if handoff is not None else {}
        writer.write(
            "queen",
            "heisenberg",
            result,
            summary_chips=handoff_summary.get(QAP_SUMMARY_CHIPS_KEY),
            summary_note=str(handoff_summary.get(QAP_SUMMARY_NOTE_KEY, "")),
        )
        if handoff is None:
            print("Warning: no handoff JSON block found in response — stopping.")
            print("Tip: check the transcript — agent may need clearer instructions.")
            break

        # Status summary
        print(f"Phases    : {handoff.tyovaihe_alku} → {handoff.tyovaihe_loppu}")
        print(f"Goal met  : {handoff.koodin_tila_vastaa_tavoitetta}")
        print(f"Can cont. : {handoff.voidaanko_jatkaa}")
        if handoff.evidence:
            print(f"Evidence  : {', '.join(handoff.evidence)}")
        print()

        # Terminal conditions
        if handoff.koodin_tila_vastaa_tavoitetta:
            print("Goal reached — stopping loop.")
            writer.write("human", "human", "[DONE — goal reached by agent]")
            break

        if not handoff.voidaanko_jatkaa:
            reason = handoff.miksi_ei_voida_jatkaa or "(no reason given)"
            print(f"Agent blocked: {reason}")
            print("Stopping — human input required.")
            writer.write("human", "human", f"[AWAITING_HUMAN — {reason}]")
            break

        # Build continuation message for the next turn
        next_message = build_qap_continue_message(
            handoff.ehdotus_jatkoon,
            handoff.tyovaihe_loppu,
            phase_pacing,
        )
        print(f"Next      : {handoff.ehdotus_jatkoon[:100]}{'...' if len(handoff.ehdotus_jatkoon) > 100 else ''}")
        print()

    else:
        print(f"Max turns ({max_turns}) reached — stopping.")
        writer.write("human", "human", f"[STOPPED — max turns {max_turns} reached]")

    print(f"\nTranscript saved: {transcript_path}")
    print(f"View with: ./queen chat {transcript_path.name}")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        prog="simple_qap",
        description="single-agent controlled loop — one Claude session, Python-driven turns",
    )
    parser.add_argument("prompt", help="Initial task prompt for the agent")
    parser.add_argument("--task-id", type=int, default=None, help="Optional DB ticket ID")
    parser.add_argument("--max-turns", type=int, default=10, help="Maximum turns before stopping (default: 10)")
    parser.add_argument(
        "--phase-pacing",
        choices=list_qap_phase_pacing_keys(),
        default=QAP_DEFAULT_PHASE_PACING,
        help="QAP phase pacing profile (default: balanced)",
    )
    parser.add_argument("--transcript", type=Path, default=None, help="Override transcript file path")
    args = parser.parse_args()

    run_qap(
        args.prompt,
        task_id=args.task_id,
        max_turns=args.max_turns,
        phase_pacing=args.phase_pacing,
        transcript_path=args.transcript,
    )


if __name__ == "__main__":
    main()
