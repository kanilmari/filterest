"""Cancellation during reader startup must stop the tool before waiting for it.

Exercise the recovery stream boundary without live tools, signals or a database.
The controlled interruption covers the startup window of the real dump test.
"""
import io
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'server_tools/lib'))
import database_recovery_tools as tools


@pytest.mark.parametrize('phase', ('construct', 'first-start', 'second-start', 'input-start', 'join'))
def test_cancellation_during_tool_reader_startup_stops_the_child(monkeypatch, phase):
    events, threads = [], []
    interrupted = False

    class Process:
        pid = 123456789
        stdout, stderr, stdin = io.BytesIO(), io.BytesIO(), io.BytesIO()

        def __enter__(self):
            return self

        def __exit__(self, *arguments):
            events.append('context wait')
            self.wait()

        def wait(self):
            events.append('wait')
            return 0

    class Thread:
        def __init__(self, **arguments):
            if phase == 'construct':
                raise InterruptedError
            self.ident = None
            self.number = len(threads) + 1
            threads.append(self)

        def start(self):
            self.ident = self.number
            if phase == {1: 'first-start', 2: 'second-start', 3: 'input-start'}[self.number]:
                raise InterruptedError

        def join(self):
            nonlocal interrupted
            assert self.ident is not None, 'Cleanup tried joining an unstarted reader'
            if phase == 'join' and not interrupted:
                interrupted = True
                raise InterruptedError

    def stop_group(pid, signum):
        assert pid == Process.pid and signum == tools.signal.SIGKILL
        events.append('stop')

    monkeypatch.setattr(tools.subprocess, 'Popen', lambda *arguments, **options: Process())
    monkeypatch.setattr(tools.threading, 'Thread', Thread)
    monkeypatch.setattr(tools.os, 'killpg', stop_group)
    with pytest.raises(InterruptedError):
        tools.checked_tool_streams(['tool'], {}, io.BytesIO(b'input'), None, b'K' * 32)
    assert events[0] == 'stop', 'Cancellation waited for the tool before stopping it'
    assert events.count('stop') == 1 and 'wait' in events
