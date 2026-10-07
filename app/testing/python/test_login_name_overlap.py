"""LT4 deliberate overlap: confirm the waiter in pg_locks before committing.

Uses independent psql processes on the disposable fixture's Unix socket only.
READ COMMITTED must refuse the conflicting write; stronger isolation may raise
40001. In either order, successful commits must leave the administrator invariant.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
import os
import subprocess
import time

import pytest
from test_login_name_postgres import cluster, installed, value  # noqa: F401


def connection_command(run, application_name):
    # Inspect only our disposable runner, never configured installation credentials.
    info = value(run, "SELECT current_setting('unix_socket_directories') || '|' || current_setting('port') || '|' || current_database() || '|' || current_user").split('|')
    binary = Path(os.environ.get('PG_TEST_BIN', '/usr/lib/postgresql/16/bin')) / 'psql'
    return [str(binary), '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
            '-d', f'host={info[0]} port={info[1]} dbname={info[2]} user={info[3]} application_name={application_name}']


@contextmanager
def held_transaction(run, sql, isolation):
    process = subprocess.Popen(connection_command(run, 'wl132_holder'), stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        process.stdin.write(f"BEGIN ISOLATION LEVEL {isolation};\nSET LOCAL statement_timeout='10s';\n{sql};\n\\echo held\n")
        process.stdin.flush()
        while True:
            line = process.stdout.readline()
            if line.strip() == 'held':
                break
            if not line:
                raise AssertionError(process.stderr.read())
        yield process
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)


def wait_until_blocked(run, future):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        blocked = value(run, """SELECT count(*) FROM pg_locks locks JOIN pg_stat_activity activity ON activity.pid=locks.pid
            WHERE activity.application_name='wl132_waiter' AND NOT locks.granted
                AND locks.locktype IN ('transactionid','tuple')""")
        if int(blocked) > 0:
            return
        if future.done():
            raise AssertionError(f'write did not wait: {future.result().stderr}')
        time.sleep(0.02)
    raise AssertionError('waiting session was never confirmed in pg_locks')


@pytest.mark.parametrize('isolation', ['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'])
@pytest.mark.parametrize('scenario', ['display_then_login','login_then_display',
                                     'flag_then_display','display_then_flag',
                                     'membership_then_display','display_then_membership'])
def test_overlapping_names_and_promotion_preserve_invariant(installed, isolation, scenario):
    run = installed
    admin = scenario in ('display_then_login','login_then_display')
    run(f"""INSERT INTO system_users(id,username,admin_access_allowed) VALUES (42,'display_start',{str(admin).lower()});
        INSERT INTO restricted.users_restricted(id,password,email,login_name) VALUES (42,'h','42@example.invalid','login_start');""")
    display = "UPDATE system_users SET username='joined_name' WHERE id=42"
    login = "UPDATE restricted.users_restricted SET login_name='joined_name' WHERE id=42"
    flag = 'UPDATE system_users SET admin_access_allowed=true WHERE id=42'
    membership = 'INSERT INTO system_user_group_memberships(user_id,group_id) VALUES (42,1)'
    if not admin:
        run("UPDATE restricted.users_restricted SET login_name='joined_name' WHERE id=42")
    statements = {'display': display, 'login': login, 'flag': flag, 'membership': membership}
    first, second = scenario.split('_then_')
    with held_transaction(run, statements[first], isolation) as holder, ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(subprocess.run, connection_command(run, 'wl132_waiter'),
            input=f"\\set VERBOSITY verbose\nBEGIN ISOLATION LEVEL {isolation}; SET LOCAL statement_timeout='10s'; "
                  f"SELECT count(*) FROM system_users WHERE id=42; {statements[second]}; COMMIT;",
            text=True, capture_output=True, timeout=15)
        try:
            wait_until_blocked(run, future)
        finally:
            holder.stdin.write('COMMIT;\n')
            holder.stdin.flush()
        output, errors = holder.communicate(timeout=5)
        assert holder.returncode == 0, errors + output
        result = future.result(timeout=10)
    assert result.returncode != 0, 'the conflicting write committed'
    accepted_errors = ('23514',) if isolation == 'READ COMMITTED' else ('23514','40001')
    assert any(code in result.stderr for code in accepted_errors), result.stderr
    assert 'joined_name' not in result.stderr
    assert value(run, """SELECT count(*) FROM system_users u JOIN restricted.users_restricted c USING (id)
        WHERE app_is_administrator_account(u.id) AND lower(btrim(u.username))=lower(btrim(c.login_name))""") == '0'


def test_two_membership_inserts_do_not_upgrade_foreign_key_locks(installed):
    run = installed
    run("""INSERT INTO system_users(id,username) VALUES(42,'membership_display');
        INSERT INTO restricted.users_restricted(id,password,email,login_name)
        VALUES(42,'h','42@example.invalid','membership_login');""")
    # A barrier compatible with FK KEY SHARE lets both inserts reach the account
    # trigger before either can proceed. FOR UPDATE plus id=id deadlocks here.
    with held_transaction(run, 'SELECT id FROM system_users WHERE id=42 FOR NO KEY UPDATE', 'READ COMMITTED') as holder, ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(subprocess.run, connection_command(run, f'wl132_member_{group}'),
            input=f"BEGIN; SET LOCAL statement_timeout='10s'; INSERT INTO system_user_group_memberships(user_id,group_id) VALUES(42,{group}); COMMIT;",
            text=True, capture_output=True, timeout=15) for group in (1, 2)]
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            count = int(value(run, """SELECT count(DISTINCT activity.pid) FROM pg_locks locks
                JOIN pg_stat_activity activity ON activity.pid=locks.pid
                WHERE activity.application_name IN ('wl132_member_1','wl132_member_2') AND NOT locks.granted"""))
            if count == 2:
                break
            if any(future.done() for future in futures):
                raise AssertionError('membership insert did not reach the row-lock barrier')
            time.sleep(0.02)
        else:
            raise AssertionError('both membership waiters were not observed')
        holder.stdin.write('COMMIT;\n')
        holder.stdin.flush()
        output, errors = holder.communicate(timeout=5)
        assert holder.returncode == 0, errors + output
        for future in futures:
            result = future.result(timeout=10)
            assert result.returncode == 0, result.stderr
    assert value(run, 'SELECT count(*) FROM system_user_group_memberships WHERE user_id=42') == '2'
