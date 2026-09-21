"""Keep the read-only database inspection command unable to change data.

Bridges the `./db` / `./filterest database` query validation with the
PostgreSQL session it opens. Exists so a query shaped to slip past the text
checks still meets a read-only transaction that is never committed.
"""

from __future__ import annotations

import pytest

from server_tools.agent_tools import db


@pytest.mark.parametrize(
    "query",
    [
        "SELECT 1",
        "select 1;",
        "  SELECT 1 ;  ",
        "WITH recent AS (SELECT id FROM system_db_tables) SELECT count(*) FROM recent",
        "SELECT updated_at, created FROM system_db_tables",
        "SELECT t.insert FROM some_table t",
        "SELECT '/api/create-folder; DROP' AS path",
        "SELECT 'it''s; UPDATE' AS escaped",
        "SELECT E'a\\'; UPDATE' AS backslash_escaped",
        'SELECT 1 AS "insert; delete"',
        "SELECT $$UPDATE; DROP$$ AS body, $tag$;$tag$ AS tagged",
        "SELECT 1 -- a comment; UPDATE nothing",
        "SELECT /* nested /* ; DELETE */ still comment */ 1",
        "SELECT $1",
    ],
)
def test_single_read_statements_are_accepted(query: str) -> None:
    assert db.validate_readonly_query(query) == (True, None)


@pytest.mark.parametrize(
    ("query", "reason"),
    [
        ("UPDATE users SET name = 'x'", "must start with SELECT or WITH"),
        ("create temporary table probe(a int)", "must start with SELECT or WITH"),
        ("SELECT 1; UPDATE users SET name = 'x'", "Only one SQL statement"),
        ("SELECT 1;UPDATE users SET name = 'x'", "Only one SQL statement"),
        ("SELECT 1;/**/UPDATE users SET name = 'x'", "Only one SQL statement"),
        ("SELECT 1; COMMIT", "Only one SQL statement"),
        ("SELECT 1; SET default_transaction_read_only = off", "Only one SQL statement"),
        ("SELECT '--'; UPDATE users SET name = 'x'", "Only one SQL statement"),
        ("SELECT E'\\''; UPDATE users SET name = 'x'", "Only one SQL statement"),
        (
            "WITH gone AS (DELETE FROM users RETURNING id) SELECT count(*) FROM gone",
            "Forbidden keyword 'DELETE'",
        ),
        ("SELECT 'unterminated", "unterminated"),
        ("SELECT $$unterminated", "unterminated"),
        ("SELECT 1 /* unterminated", "unterminated"),
        ("WITH nothing AS (VALUES (1)) TABLE nothing", "must contain a SELECT"),
    ],
)
def test_writes_and_second_statements_are_refused(query: str, reason: str) -> None:
    is_valid, message = db.validate_readonly_query(query)

    assert is_valid is False
    assert reason in message


class _RecordingCursor:
    def __init__(self, events: list[tuple], *, fail: bool) -> None:
        self.events = events
        self.fail = fail
        self.description = [("one",)]
        self.rowcount = 1

    def execute(self, query: str) -> None:
        self.events.append(("execute", query))
        if self.fail:
            raise RuntimeError("cannot execute SELECT INTO in a read-only transaction")

    def fetchall(self) -> list[tuple]:
        return [(1,)]


class _RecordingConnection:
    def __init__(self, events: list[tuple], *, fail: bool) -> None:
        self.events = events
        self.fail = fail

    def set_session(self, **settings) -> None:
        self.events.append(("set_session", settings))

    def cursor(self) -> _RecordingCursor:
        return _RecordingCursor(self.events, fail=self.fail)

    def commit(self) -> None:
        self.events.append(("commit",))

    def rollback(self) -> None:
        self.events.append(("rollback",))

    def close(self) -> None:
        self.events.append(("close",))


def _recording_connect(events: list[tuple], *, fail: bool = False):
    def connect(**arguments) -> _RecordingConnection:
        events.append(("connect", arguments))
        return _RecordingConnection(events, fail=fail)

    return connect


def test_query_runs_in_a_read_only_transaction_that_is_rolled_back() -> None:
    events: list[tuple] = []

    rows = db.run_readonly_query(
        "SELECT 1 AS one",
        connect=_recording_connect(events),
        host="localhost",
        dbname="filterest",
        user="filterest_readonly",
    )

    assert rows == [{"one": 1}]
    assert events == [
        (
            "connect",
            {
                "options": "-c default_transaction_read_only=on",
                "host": "localhost",
                "dbname": "filterest",
                "user": "filterest_readonly",
            },
        ),
        ("set_session", {"readonly": True, "autocommit": False}),
        ("execute", "SELECT 1 AS one"),
        ("rollback",),
        ("close",),
    ]


def test_a_refused_query_still_rolls_back_and_never_commits() -> None:
    events: list[tuple] = []

    with pytest.raises(RuntimeError, match="read-only transaction"):
        db.run_readonly_query(
            "SELECT * INTO probe FROM (SELECT 1) s",
            connect=_recording_connect(events, fail=True),
        )

    assert ("commit",) not in events
    assert events[-2:] == [("rollback",), ("close",)]


def test_missing_driver_points_to_development_setup(monkeypatch, capsys) -> None:
    # A fresh clone runs host Python until the development setup installs psycopg2.
    monkeypatch.setattr(db, "psycopg2", None)
    monkeypatch.setattr(db, "load_env_chain", lambda paths: {})
    monkeypatch.setattr("sys.argv", ["db.py", "--local", "SELECT 1"])

    with pytest.raises(SystemExit) as exit_info:
        db.main()

    assert exit_info.value.code == 1
    output = capsys.readouterr().out
    assert "./filterest setup --profile development" in output
    assert "Traceback" not in output


def test_standalone_installation_declares_no_docker_instances(monkeypatch) -> None:
    def forbidden(*arguments, **keywords):
        raise AssertionError("docker must not be queried without a declared instance layout")

    monkeypatch.setattr(db.subprocess, "run", forbidden)

    assert db.get_running_db_instances(environment={}) == []
    assert db.get_instance_env("example.org", environment={}) == {}
    assert (db.DEFAULT_DB_NAME, db.DEFAULT_READONLY_USER) == ("filterest", "filterest_readonly")


def test_declared_instance_layout_is_detected_and_read(monkeypatch, tmp_path) -> None:
    calls = []

    class Completed:
        stdout = (
            "acme-example.org-db\t0.0.0.0:5491->5432/tcp\n"
            "acme-example.org-app\t0.0.0.0:8091->8080/tcp\n"
            "unrelated-db\t0.0.0.0:5499->5432/tcp\n"
        )

    def fake_run(command, **keywords):
        calls.append(command)
        return Completed()

    monkeypatch.setattr(db.subprocess, "run", fake_run)
    instance_home = tmp_path / "instances/example.org"
    instance_home.mkdir(parents=True)
    (instance_home / ".env").write_text("DB_NAME=acme\nDB_READONLY_USER=acme_reader\n")
    layout = {
        db.INSTANCE_CONTAINER_PREFIX_ENV: "acme-",
        db.INSTANCES_DIR_ENV: str(tmp_path / "instances"),
    }

    assert db.get_running_db_instances(environment=layout) == [("example.org", "5491")]
    assert calls[0][-1] == "name=acme-"
    assert db.get_instance_env("example.org", environment=layout) == {
        "DB_NAME": "acme",
        "DB_READONLY_USER": "acme_reader",
    }
