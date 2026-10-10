"""recovery_process_boundary.py: whole-process output for named recovery commands.

Connects direct shell/Python invocation with the existing spelling scanner.
Captures interpreter diagnostics, keeps separate streams/status, and waits to drain.
The reentry state belongs to the new interpreter and cannot be exported by a caller.
"""
from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
import sys

SHELL_REENTRY = 'unset FILTEREST_RECOVERY_PROCESS_PID; readonly FILTEREST_RECOVERY_PROCESS_PID="$BASHPID"; source "$0" "$@"'
_python_script = None


def installation_root(script, application, environment):
    """Use the existing standalone/embedded layout before helpers can fail."""
    application = Path(application).absolute()
    if Path(script).absolute().parent == application.parent:
        return application.parent  # Public launchers bind their own installation.
    name = Path(script).name
    if name == "run_filterest_docker.sh":
        # The runner binds only PROJECT_ROOT_OVERRIDE, otherwise app's parent;
        # FILTEREST_ROOT and the optional embedding root do not select its key.
        return Path(environment.get("FILTEREST_PROJECT_ROOT_OVERRIDE") or application.parent).absolute()
    if name == "ctl":
        # Direct app/ctl also ignores FILTEREST_ROOT when selecting its layout.
        supplied = environment.get("FILTEREST_PROJECT_ROOT_OVERRIDE")
    elif name == "update_filterest.sh":
        supplied = environment.get("FILTEREST_ROOT") or environment.get("FILTEREST_PROJECT_ROOT_OVERRIDE")
    else:
        supplied = environment.get("FILTEREST_PROJECT_ROOT_OVERRIDE") or environment.get("FILTEREST_ROOT")
    if supplied:
        return Path(supplied).absolute()
    if application.name == "app" and (application / "go.mod").is_file() and (application / "VERSION_APP").is_file():
        root = application.parent
        if (root.parent / ".git").exists() and (root.parent / "VERSION_EASELECT").is_file():
            root = root.parent
        return root
    return application


def scanner(root):
    """Load once before starting application code; bootstrap failures stay fixed."""
    from database_recovery_packet_io import prime_diagnostic_key, safe_diagnostic
    prime_diagnostic_key(root)
    # Import scanner dependencies eagerly, even if the output would be empty.
    safe_diagnostic("", utility_escapes=True)
    return lambda content: safe_diagnostic(content.decode("utf-8", errors="surrogateescape"),
        utility_escapes=True).encode("utf-8", errors="surrogateescape")


def run_process(command, environment, root, *, pass_fds=()):
    """Wait for both EOFs and scan all bytes, including implicit diagnostics.

    A combined output file retains the child's output order. Separate operator
    destinations retain separate scanners; internal data stdout stays private to
    its consumer until it reaches this outer boundary. Only the existing fixed
    confirmation prompt gets the original stderr descriptor while stdin is live.
    """
    redact = scanner(root)
    environment = dict(environment)
    # Imported source can carry key copies; a recovery command must not retain
    # unscanned interpreter cache files through a child helper's normal imports.
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    for name in ("FILTEREST_RECOVERY_STDERR_PIPE", "FILTEREST_RECOVERY_STDERR_DESTINATION"):
        environment.pop(name, None)
    # Descriptor 7 is reserved for already-scanned interactive context and the
    # fixed update prompt on original stdout; 8 owns the fixed restore prompt.
    context = environment.get("FILTEREST_RECOVERY_CONTEXT_FD") == "7"
    try:
        if not context:
            raise OSError
        os.fstat(7)
    except OSError:
        os.dup2(sys.stdout.fileno(), 7)
    environment["FILTEREST_RECOVERY_CONTEXT_FD"] = "7"
    prompt = environment.get("FILTEREST_RECOVERY_PROMPT_FD") == "8"
    try:
        if not prompt:
            raise OSError
        os.fstat(8)
    except OSError:
        os.dup2(sys.stderr.fileno(), 8)
    environment["FILTEREST_RECOVERY_PROMPT_FD"] = "8"
    merged = os.path.sameopenfile(sys.stdout.fileno(), sys.stderr.fileno())
    child = subprocess.Popen(command, env=environment, stdin=None, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT if merged else subprocess.PIPE,
        pass_fds=tuple(set((*pass_fds, 7, 8))))
    cancelled = False
    previous = {}

    def interrupt(signum, frame):
        nonlocal cancelled
        if not cancelled:
            cancelled = True
            child.send_signal(signum)

    for signum in (signal.SIGINT, signal.SIGTERM):
        previous[signum] = signal.signal(signum, interrupt)
    try:
        output, errors = child.communicate()
        # Redact both before releasing either: failure withholds all raw output
        # but must not rewrite a status already returned by the application.
        try:
            output = redact(output)
            errors = redact(errors) if errors is not None else None
        except BaseException:
            sys.stderr.write("Recovery diagnostic unavailable; sensitive details withheld.\n")
            sys.stderr.flush()
        else:
            sys.stdout.buffer.write(output)
            sys.stdout.buffer.flush()
            if errors is not None:
                sys.stderr.buffer.write(errors)
                sys.stderr.buffer.flush()
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    # Existing launcher handlers return 130; a direct application may own a
    # different cancellation status. Preserve the status its handler chose.
    return 128 - child.returncode if child.returncode < 0 else child.returncode


def shell_entrypoint(script, application, arguments, encoded_environment):
    environment = dict(os.fsdecode(item).split("=", 1) for item in encoded_environment.split(b"\0") if item)
    root = installation_root(script, application, environment)
    # The reentry interpreter owns startup and its call frame. Inherited startup
    # code must not run before that frame or install readonly protocol variables.
    environment.pop("BASH_ENV", None)
    environment.pop("BASH_EXECUTION_STRING", None)
    return run_process(["/bin/bash", "-c", SHELL_REENTRY, str(Path(script).absolute()), *arguments], environment, root)


def python_entrypoint(script):
    """Direct Python commands reenter under captured stdout/stderr before imports.

    The child's in-memory module state is created by this isolated bootstrap;
    environment variables and inherited descriptors cannot skip the boundary.
    Missing bootstrap/scanner imports are refused by the caller with fixed text.
    """
    if _python_script == str(Path(script).absolute()):
        return
    root = Path(script).resolve().parents[3]
    arguments = sys.argv[1:]
    # The CLI parser still owns fixed missing-value errors. Learn the root only
    # for diagnostic scanning; no packet/setting is accepted by this lookup.
    for index, argument in enumerate(arguments):
        if argument == "--root" and index + 1 < len(arguments):
            root = arguments[index + 1]
        elif argument.startswith("--root="):
            root = argument.split("=", 1)[1]
    code = '''
import os, runpy, sys
script = os.read(3, 1048576).decode("utf-8", errors="surrogateescape")
sys.path.insert(0, os.path.dirname(script))
import recovery_process_boundary as boundary
boundary._python_script = script
sys.argv[0] = "Filterest recovery"
runpy.run_path(script, run_name="__main__")
'''
    # A private descriptor carries the path, never script bytes or operator argv[0].
    readfd, writefd = os.pipe()
    if readfd in (7, 8):
        import fcntl
        replacement = fcntl.fcntl(readfd, fcntl.F_DUPFD, 10)
        os.close(readfd)
        readfd = replacement
    try:
        os.write(writefd, os.fsencode(str(Path(script).absolute())))
        os.close(writefd)
        # fd 3 is not assumed free in a host Python invocation.
        code = code.replace("os.read(3,", f"os.read({readfd},")
        status = run_process([sys.executable, "-I", "-B", "-c", code, *arguments],
            os.environ, root, pass_fds=(readfd,))
    finally:
        os.close(readfd)
    raise SystemExit(status)
