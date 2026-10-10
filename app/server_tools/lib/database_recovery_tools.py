"""database_recovery_tools.py: scan tool streams before any recovery file write.

Connects PostgreSQL/container transports with protected artifacts and diagnostics.
Keeps unfiltered stdout, stderr and SQL in memory/pipes rather than temporary files.
"""
from __future__ import annotations

import io
import os
import re
import signal
import subprocess
import threading

if __package__:
    from .database_recovery_packet_io import RecoveryError, safe_diagnostic
    from .recovery_key_safety import KeyScanner, KeySafeWriter, reject_key_name, private_temporary_path
else:
    from database_recovery_packet_io import RecoveryError, safe_diagnostic
    from recovery_key_safety import KeyScanner, KeySafeWriter, reject_key_name, private_temporary_path


def checked_tool_streams(command, environment, source, destination, key):
    """Drain both output pipes concurrently; refuse a match before any disk write."""
    for argument in command:
        reject_key_name(argument, key)
    output, errors, failures = io.BytesIO(), io.BytesIO(), []
    with subprocess.Popen(command, env=environment, stdin=subprocess.PIPE if source else subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True) as process:
        def stop_tool():
            # Kill pipe-holding descendants too, so cancellation can finish cleanup.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        def transfer(stream, sink):
            scanner = KeyScanner(key)
            try:
                while chunk := stream.read(65536):
                    scanner.check(chunk)
                    sink.write(chunk)
            except BrokenPipeError:
                pass  # A failing tool may close stdin before consuming its source.
            except BaseException as error:
                failures.append(error)
                stop_tool()
            finally:
                if stream in (process.stdout, process.stderr):
                    stream.close()
                else:
                    process.stdin.close()
        threads = []
        try:
            # A signal during reader construction/startup must stop the tool too;
            # otherwise Popen's context exit waits for a hanging escaped child.
            threads = [threading.Thread(target=transfer, args=(process.stdout, destination or output)),
                       threading.Thread(target=transfer, args=(process.stderr, errors))]
            if source:
                threads.append(threading.Thread(target=transfer, args=(source, process.stdin)))
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            status = process.wait()
        except BaseException:
            stop_tool()
            for thread in threads:
                # Thread.start itself can be interrupted; join only readers
                # whose bootstrap has started, including already-finished ones.
                if thread.ident is not None:
                    thread.join()
            process.wait()
            raise
        if failures:
            raise failures[0]
    return status, output.getvalue(), errors.getvalue()


def run_database_tool(database, command, *, source=None, destination=None, sensitive=False):
    """Retain only checked, credential-redacted logs, including on tool failure."""
    reject_key_name(database.folder, database.key)
    descriptor, filename = private_temporary_path(database.folder, database.key, prefix="database-tool-", suffix=".log")
    os.fchmod(descriptor, 0o600)
    with KeySafeWriter(os.fdopen(descriptor, "wb"), database.key) as log:
        try:
            status, content, diagnostics = checked_tool_streams(command, database.environment, source, destination, database.key)
        except RecoveryError:
            log.write(b"Recovery tool stream refused: authentication key representation detected.\n")
            raise
        except OSError:
            log.write(b"Required recovery command unavailable.\n")
            raise RecoveryError(f"A required recovery command is unavailable; log: {filename}") from None
        if sensitive:
            log.write(b"Protected standard output withheld to protect credentials.\n")
            for code in re.findall(rb"(?:ERROR|FATAL|WARNING):\s+([A-Z0-9]{5})(?:\s|$)", diagnostics):
                log.write(b"PostgreSQL SQLSTATE: " + code + b"\n")
            if diagnostics:
                log.write(b"Protected diagnostic text redacted.\n")
        else:
            text = (content + diagnostics).decode("utf-8", errors="replace")
            text = re.sub(r"(?im)^.*(?:PASSWORD|SCRAM-SHA-256|md5[0-9a-f]{32}).*$", "[credential redacted]", text)
            for secret in database.hidden:
                text = text.replace(secret, "[secret redacted]")
            log.write(safe_diagnostic(text, database.key).encode())
        if destination:
            log.write(b"Standard output written to protected artifact; archive content omitted.\n")
        log.write(f"Exit status: {status}\n".encode())
        if status:
            raise RecoveryError(f"The recovery command failed; private diagnostic log: {filename}")
        return content
