"""test_instance_ctl_bash32_compatibility.py
Exercises instance-control shell helpers through the system Bash entry point.
Bridges macOS /bin/bash 3.2, ctl instance modules, and dump-policy arrays.
Exists so portable instance management does not regress to Bash 4 or GNU-only syntax.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SYSTEM_BASH = Path("/bin/bash")


def run_system_bash(script: str, *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    """Run one regression scenario through the platform's /bin/bash."""

    env = os.environ.copy()
    env["PROJECT_ROOT"] = str(cwd or PROJECT_ROOT)
    return subprocess.run(
        [str(SYSTEM_BASH), "-euo", "pipefail", "-c", script],
        cwd=cwd or PROJECT_ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


class InstanceCtlBash32CompatibilityTests(unittest.TestCase):
    def test_case_insensitive_instance_resolution_uses_portable_lowercase(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            (temp_root / "instances" / "CustomerPortal").mkdir(parents=True)
            (temp_root / "instances" / "template").mkdir()

            result = run_system_bash(
                f'source "{PROJECT_ROOT}/server_tools/ctl/lib/common.sh"\n'
                'resolved="$(resolve_instance_name PORTAL)"\n'
                'printf "%s|%s\\n" "$(ascii_lowercase MiXeD)" "$resolved"',
                cwd=temp_root,
            )

        self.assertEqual(result.stdout, "mixed|CustomerPortal\n")

    def test_instance_list_normalizes_production_under_system_bash(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            (temp_root / "instances" / "example").mkdir(parents=True)
            (temp_root / ".env").write_text("DB_PORT=5433\n", encoding="utf-8")
            (temp_root / "dev_env.txt").write_text("APP_PORT=8082\n", encoding="utf-8")
            (temp_root / "instances" / "example" / ".env").write_text(
                "DOMAIN=example.test\n"
                "APP_PORT=8090\n"
                "DB_PORT=5490\n"
                "ENVIRONMENT_TYPE=Production\n"
                "INSTANCE_TYPE=derivative\n",
                encoding="utf-8",
            )

            result = run_system_bash(
                f'source "{PROJECT_ROOT}/server_tools/ctl/lib/common.sh"\n'
                f'source "{PROJECT_ROOT}/server_tools/ctl/lib/instance_helpers.sh"\n'
                f'source "{PROJECT_ROOT}/server_tools/ctl/lib/instance_list.sh"\n'
                'docker() { return 1; }\n'
                'curl() { return 1; }\n'
                "list_instances",
                cwd=temp_root,
            )

        self.assertIn("PROD", result.stdout)
        self.assertIn("https://example.test", result.stdout)

    def test_seed_credentials_are_read_without_gnu_grep(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            (temp_root / "dev_env.txt").write_text(
                "DB_HOST=db.example.test\n"
                "DB_PORT=5543\n"
                "DB_NAME=seed_db\n"
                "###DB_USER=seed_admin### agent note ###\n"
                "###DB_PASSWORD=dummy-password### agent note ###\n",
                encoding="utf-8",
            )

            result = run_system_bash(
                'RED=""; NC=""\n'
                f'source "{PROJECT_ROOT}/server_tools/ctl/lib/instance_helpers.sh"\n'
                "read_seed_db_config\n"
                'printf "%s|%s|%s|%s|%s\\n" "$seed_host" "$seed_port" '
                '"$seed_name" "$seed_user" "$seed_password"',
                cwd=temp_root,
            )

        self.assertEqual(
            result.stdout,
            "db.example.test|5543|seed_db|seed_admin|dummy-password\n",
        )

    def test_dump_policy_output_arrays_work_without_namerefs(self) -> None:
        result = run_system_bash(
            'source "$PROJECT_ROOT/server_tools/lib/sql_dump_policy.sh"\n'
            "rows=$'public\\trequest log\\tschema_only\\nrestricted\\tsecret\\tnone'\n"
            "built=(stale)\n"
            'build_sql_dump_policy_flags_from_rows built "$rows"\n'
            'printf "built-count=%s\\n" "${#built[@]}"\n'
            'printf "built=%s\\n" "${built[@]}"\n'
            'empty=()\nprintf "empty=<"\nsql_dump_policy_flags_preview empty\nprintf ">\\n"\n'
            "docker() { printf 'public\\tdocker_cache\\tschema_only\\n'; }\n"
            "psql() { printf 'public\\tlocal_cache\\tschema_only\\n'; }\n"
            "sudo() { printf 'restricted\\tsuper_secret\\tnone\\n'; }\n"
            "docker_flags=()\nlocal_flags=()\nsuper_flags=()\n"
            'load_sql_dump_policy_flags_from_docker db dbname docker_flags admin\n'
            'load_sql_dump_policy_flags_from_local_credentials host 5432 db user pass local_flags\n'
            'load_sql_dump_policy_flags_from_local_superuser 5432 db super_flags\n'
            'printf "loaders=%s|%s|%s\\n" "${docker_flags[0]}" '
            '"${local_flags[0]}" "${super_flags[0]}"',
        )

        self.assertIn("built-count=2", result.stdout)
        self.assertIn("built=--exclude-table-data=public.request log", result.stdout)
        self.assertIn("built=--exclude-table=restricted.secret", result.stdout)
        self.assertIn("empty=<>", result.stdout)
        self.assertIn(
            "loaders=--exclude-table-data=public.docker_cache|"
            "--exclude-table-data=public.local_cache|"
            "--exclude-table=restricted.super_secret",
            result.stdout,
        )

    def test_go_minimum_version_check_is_portable_and_fail_closed(self) -> None:
        result = run_system_bash(
            'source "$PROJECT_ROOT/server_tools/lib/toolchain_version.sh"\n'
            'for version in go1.26.5 go1.26.6 go1.27.0; do\n'
            '  easelect_go_meets_minimum "$version"\n'
            'done\n'
            'for version in go1.26.4 go1.25.99 go1.26 devel; do\n'
            '  if easelect_go_meets_minimum "$version"; then exit 9; fi\n'
            'done\n'
            'go() { printf "go version go1.26.5 darwin/arm64\\n"; }\n'
            'printf "%s|ok\\n" "$(easelect_detect_go_version)"',
        )

        self.assertEqual(result.stdout, "go1.26.5|ok\n")

    def test_machine_migration_generates_private_payment_callback_secret(self) -> None:
        migration_source = (
            PROJECT_ROOT / "server_tools" / "migrate_to_new_machine.sh"
        ).read_text(encoding="utf-8")

        self.assertIn("payment_callback_secret=$(openssl rand -hex 32)", migration_source)
        self.assertIn("PAYMENT_CALLBACK_SECRET=${payment_callback_secret}", migration_source)
        self.assertNotRegex(
            migration_source,
            re.compile(r"(?:echo|printf)[^\n]*payment_callback_secret"),
        )

    def test_instance_backup_policy_preserves_defaults_without_duplicates(self) -> None:
        result = run_system_bash(
            'BLUE=""; YELLOW=""; NC=""\n'
            'source "$PROJECT_ROOT/server_tools/lib/sql_dump_policy.sh"\n'
            'source "$PROJECT_ROOT/server_tools/ctl/lib/instance_backup.sh"\n'
            "docker() { printf 'public\\tsystem_log\\tschema_only\\n'; }\n"
            "flags=(stale)\n"
            'load_instance_backup_policy_flags container db admin flags\n'
            'append_default_instance_backup_exclusions flags\n'
            'append_default_instance_backup_exclusions flags\n'
            'printf "count=%s\\n" "${#flags[@]}"\n'
            'printf "%s\\n" "${flags[@]}"',
        )

        self.assertIn("count=6", result.stdout)
        self.assertEqual(
            result.stdout.count("--exclude-table-data=public.system_log"),
            1,
        )

    def test_instance_database_backup_is_owner_readable_only(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            backup_file = temp_root / "instances" / "example" / "backups" / "backup.sql.gz"
            backup_file.parent.mkdir(parents=True)
            backup_file.write_bytes(b"stale")
            backup_file.chmod(0o664)

            run_system_bash(
                'BLUE=""; YELLOW=""; NC=""\n'
                f'source "{PROJECT_ROOT}/server_tools/ctl/lib/instance_backup.sh"\n'
                'load_instance_backup_policy_flags() { eval "$4=()"; }\n'
                'append_default_instance_backup_exclusions() { :; }\n'
                'docker() { printf "private backup"; }\n'
                'gzip() { cat; }\n'
                f'write_instance_database_backup example "{backup_file}" admin easelect',
                cwd=temp_root,
            )

            self.assertEqual(backup_file.read_bytes(), b"private backup")
            self.assertEqual(backup_file.stat().st_mode & 0o777, 0o600)

    def test_instance_retirement_uses_protected_trash_and_keeps_named_volumes(self) -> None:
        crud_source = (
            PROJECT_ROOT / "server_tools" / "ctl" / "lib" / "instance_crud.sh"
        ).read_text(encoding="utf-8")
        backup_source = (
            PROJECT_ROOT / "server_tools" / "ctl" / "lib" / "instance_backup.sh"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "data/instance_trash/deleted_instances/${instance}_${retirement_timestamp}",
            crud_source,
        )
        self.assertIn(
            'backup_instance "$instance" "$retirement_db_file"',
            crud_source,
        )
        self.assertIn('mv "$instance_dir" "$retired_instance_dir"', crud_source)
        self.assertNotIn('$(compose_cmd "$instance") down -v', crud_source)
        self.assertNotIn('rm -rf "$instance_dir"', crud_source)
        self.assertIn('local requested_backup_file="${2:-}"', backup_source)
        self.assertIn("chmod 700 \"$backup_dir\"", backup_source)

    def test_instance_retirement_preserves_active_and_deleted_media(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            instance_root = temp_root / "instances" / "example"
            (instance_root / "storage").mkdir(parents=True)
            (instance_root / "storage_deleted").mkdir()
            (instance_root / ".env").write_text("INSTANCE=example\n", encoding="utf-8")
            (instance_root / "storage" / "active.txt").write_text(
                "active", encoding="utf-8"
            )
            (instance_root / "storage_deleted" / "archived.txt").write_text(
                "archived", encoding="utf-8"
            )

            result = run_system_bash(
                'RED=""; GREEN=""; BLUE=""; YELLOW=""; NC=""\n'
                f'source "{PROJECT_ROOT}/server_tools/ctl/lib/instance_crud.sh"\n'
                'docker() { return 0; }\n'
                'compose_cmd() { printf "fake_compose"; }\n'
                'fake_compose() { printf "%s\\n" "$*" >> compose_calls.txt; }\n'
                'printf "example\\n" | delete_instance example',
                cwd=temp_root,
            )

            retirement_roots = list(
                (temp_root / "data" / "instance_trash" / "deleted_instances").glob(
                    "example_*"
                )
            )
            self.assertEqual(len(retirement_roots), 1)
            retired_instance = retirement_roots[0] / "instance"
            self.assertFalse(instance_root.exists())
            self.assertEqual(
                (retired_instance / "storage" / "active.txt").read_text(
                    encoding="utf-8"
                ),
                "active",
            )
            self.assertEqual(
                (
                    retired_instance / "storage_deleted" / "archived.txt"
                ).read_text(encoding="utf-8"),
                "archived",
            )
            self.assertEqual(
                (temp_root / "compose_calls.txt").read_text(encoding="utf-8"),
                "down\n",
            )
            self.assertIn("Docker named volumes were retained", result.stdout)

    def test_management_instance_config_needs_no_in_place_sed(self) -> None:
        instance_crud = (
            PROJECT_ROOT / "server_tools" / "ctl" / "lib" / "instance_crud.sh"
        ).read_text(encoding="utf-8")
        self.assertNotRegex(instance_crud, re.compile(r"^\s*sed\s+-i\b", re.MULTILINE))

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            result = run_system_bash(
                'RED=""; GREEN=""; BLUE=""; NC=""\n'
                f'source "{PROJECT_ROOT}/server_tools/ctl/lib/instance_helpers.sh"\n'
                f'source "{PROJECT_ROOT}/server_tools/ctl/lib/instance_crud.sh"\n'
                '_next_instance_slot() { printf "3\\n"; }\n'
                'create_instance management-demo demo.test management >/dev/null\n'
                'env_file="instances/management-demo/.env"\n'
                "printf '%s|%s|%s\\n' "
                '"$(grep -c \"^SITE_NAME=\" \"$env_file\")" '
                '"$(grep -c \"^CLOUD_MANAGEMENT_UI_ENABLED=\" \"$env_file\")" '
                '"$(grep -c \"^CLOUD_ACTION_VISIBILITY_MODE=\" \"$env_file\")"',
                cwd=temp_root,
            )

        self.assertEqual(result.stdout, "1|1|1\n")

    def test_instance_shell_sources_have_no_known_bash4_or_gnu_only_constructs(self) -> None:
        source_paths = list((PROJECT_ROOT / "server_tools" / "ctl").rglob("*.sh"))
        source_paths.extend((PROJECT_ROOT / "server_tools" / "ctl").rglob("*.bash"))
        source_paths.append(PROJECT_ROOT / "server_tools" / "lib" / "sql_dump_policy.sh")
        source_paths.append(PROJECT_ROOT / "server_tools" / "lib" / "toolchain_version.sh")
        executable_source = "\n".join(
            line
            for path in source_paths
            for line in path.read_text(encoding="utf-8").splitlines()
            if not line.lstrip().startswith("#")
        )

        self.assertNotRegex(executable_source, re.compile(r"\$\{[^}\n]+,,\}"))
        self.assertNotRegex(executable_source, re.compile(r"\blocal\s+-n\b"))
        self.assertNotRegex(executable_source, re.compile(r"\bgrep\b[^\n]*\s-(?:[^\s]*P|oP)\b"))
        self.assertNotRegex(executable_source, re.compile(r"^\s*sed\s+-i\b", re.MULTILINE))


if __name__ == "__main__":
    unittest.main()
