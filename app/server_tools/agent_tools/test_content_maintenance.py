"""Test generic content planning, metadata boundaries, backups, and retry journals.

Connects a deterministic API fixture with the same public plan/apply functions as the CLI.
Protects private content and existing translations without touching any live database.
"""
from __future__ import annotations

from argparse import Namespace
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
from unittest.mock import patch

import pytest

from . import content_maintenance as cm

TARGET = "https://content.example"
DATASET = "sample_pages"


class API:
    def __init__(self):
        self.rows = [
            {"id": 8, "slug": "first", "title": {"fi": "Vanha", "en": "Old", "sv": "Behåll"},
             "enabled": False, "previous_id": None},
            {"id": 19, "slug": "second", "title": {"fi": "Toinen", "en": "Second"},
             "enabled": True, "previous_id": 8},
        ]
        self.columns = [
            {"column_name": "id", "data_type": "bigint", "is_identity": "YES", "is_nullable": "NO"},
            {"column_name": "slug", "data_type": "text", "is_nullable": "NO"},
            {"column_name": "title", "data_type": "text", "is_nullable": "YES", "is_multilingual": True,
             "multilingual_languages": [{"language_code": "fi"}, {"language_code": "en"}]},
            {"column_name": "enabled", "data_type": "boolean", "is_nullable": "NO", "column_default": "false"},
            {"column_name": "previous_id", "data_type": "bigint", "is_nullable": "YES",
             "foreign_dataset_name": DATASET, "foreign_column_name": "id"},
        ]
        for col in self.columns:
            col["insertable"] = {"Valid": True, "Bool": True}
        self.details = [{"table_name": DATASET, "table_uid": 51, "column_name": col["column_name"],
                         "editable_in_ui": col["column_name"] != "id", "hide_everywhere": False,
                         "client_delivery_mode": "include"} for col in self.columns]
        self.writes = []
        self.fail_after_write = False
        self.corrupt_readback = False
        self.base_url = TARGET

    def login(self):
        pass

    def request(self, method, path, query=None):
        assert method == "GET"
        if path == "/api/datasets":
            return {"datasets": [{"dataset_name": DATASET, "id": 9001, "can_read_rows": True}], "tab_order": ["unrelated"]}
        if path == "/api/get-add-row-metadata":
            assert query == {"table_uid": 51}
            return {"columns": copy.deepcopy(self.columns)}
        assert path == "/api/tree_data"
        return {"column_details": copy.deepcopy(self.details)}

    def get_all_dataset_rows(self, dataset, **kwargs):
        assert dataset == DATASET
        return copy.deepcopy(self.rows)

    def decoded_values(self, values):
        return {name: json.loads(value) if name == "title" and isinstance(value, str) else value
                for name, value in values.items()}

    def update_row(self, dataset, row_id, values):
        assert dataset == DATASET
        self.writes.append(("update", row_id))
        row = next(row for row in self.rows if row["id"] == row_id)
        row.update(self.decoded_values(values))
        if self.corrupt_readback:
            row["enabled"] = not row.get("enabled", False)
        if self.fail_after_write:
            raise RuntimeError("private API response must not reach CLI stdout")

    def add_row(self, dataset, values):
        assert dataset == DATASET
        new_id = max(row["id"] for row in self.rows) + 1
        self.writes.append(("create", new_id))
        self.rows.append({"id": new_id, "slug": "", "title": {}, "enabled": False,
                          "previous_id": None, **self.decoded_values(values)})
        if self.fail_after_write:
            raise RuntimeError("uncertain committed response")


@pytest.fixture
def definition():
    return {"format": 1, "rows": [{"ref": "first", "match": {"slug": "first"},
                                  "values": {"title": {"fi": "Uusi", "en": "New"}, "enabled": True}}]}


@pytest.fixture
def api():
    return API()


def apply(api, plan, tmp_path):
    return cm.apply_plan(api, plan, TARGET, DATASET, plan["plan_sha256"], "receipt.json",
                         tmp_path / "journal.json")


def test_plan_binds_live_state_metadata_and_target_without_writing(api, definition):
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    assert plan["before_sha256"] == cm.digest(plan["before"])
    assert plan["plan_sha256"] == cm.digest({k: v for k, v in plan.items() if k != "plan_sha256"})
    assert plan["metadata"]["table_uid"] == 51
    assert api.writes == []


@pytest.mark.parametrize("mutation", [
    lambda item: item["values"].update({"unknown": "x"}),
    lambda item: item["values"].update({"id": 11}),
    lambda item: item["values"].update({"enabled": "yes"}),
    lambda item: item["values"].update({"title": {"de": "Unreviewed"}}),
    lambda item: item["values"].update({"title": "not a language map"}),
    lambda item: item["values"].update({"slug": "changed-identity"}),
    lambda item: item["values"].update({"previous_id": {"$ref": "later"}}),
])
def test_invalid_field_definitions_fail_before_writes(api, definition, mutation):
    mutation(definition["rows"][0])
    with pytest.raises(cm.Conflict):
        cm.build_plan(api, TARGET, DATASET, definition)
    assert not api.writes


@pytest.mark.parametrize(("key", "value"), [
    ("editable_in_ui", False), ("hide_everywhere", True), ("client_delivery_mode", "server_only")
])
def test_metadata_visibility_and_editability_are_required(api, definition, key, value):
    next(item for item in api.details if item["column_name"] == "title")[key] = value
    with pytest.raises(cm.Conflict):
        cm.build_plan(api, TARGET, DATASET, definition)
    assert not api.writes


def test_ambiguous_matches_and_incomplete_readback_fail_closed(api, definition):
    api.rows[1]["slug"] = "first"
    with pytest.raises(cm.Conflict, match="ambiguous"):
        cm.build_plan(api, TARGET, DATASET, definition)
    api.rows[1]["slug"] = "second"
    del api.rows[1]["title"]
    with pytest.raises(cm.Conflict, match="fully readable"):
        cm.build_plan(api, TARGET, DATASET, definition)


def test_apply_preserves_other_locales_verifies_fields_and_repeats_without_writes(api, definition, tmp_path):
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    with patch.object(cm, "verify_backup", return_value="verified-artifact"):
        result = apply(api, plan, tmp_path)
        repeated = apply(api, plan, tmp_path)
    assert result["changed"] is True and result["verified"] is True
    assert repeated["changed"] is False
    assert api.rows[0]["title"] == {"fi": "Uusi", "en": "New", "sv": "Behåll"}
    assert len(api.writes) == 1
    assert cm.load_json(tmp_path / "journal.json")["state"] == "complete"
    assert (tmp_path / "journal.json").stat().st_mode & 0o077 == 0


@pytest.mark.parametrize("change", ["target", "dataset", "hash", "before", "metadata"])
def test_stale_or_retargeted_plan_is_rejected(api, definition, tmp_path, change):
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    target, dataset, confirmed = TARGET, DATASET, plan["plan_sha256"]
    if change == "target":
        target = "https://other.example"
    elif change == "dataset":
        dataset = "other_table"
    elif change == "hash":
        confirmed = "0" * 64
    elif change == "before":
        api.rows[0]["enabled"] = True
    else:
        api.columns[2]["multilingual_languages"].append({"language_code": "de"})
    with pytest.raises(cm.Conflict):
        cm.apply_plan(api, plan, target, dataset, confirmed, "receipt.json", tmp_path / "journal.json")
    assert not api.writes


def test_create_and_named_predecessor_order_do_not_duplicate_on_repeat(api, tmp_path):
    definition = {"format": 1, "rows": [
        {"ref": "new_first", "match": {"slug": "new"}, "create": True,
         "values": {"title": {"fi": "Uusi", "en": "New"}, "enabled": True}},
        {"ref": "old_first", "match": {"slug": "first"}, "values": {}},
    ], "order": {"field": "previous_id", "refs": ["new_first", "old_first"]}}
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    with patch.object(cm, "verify_backup", return_value="verified-artifact"):
        assert apply(api, plan, tmp_path)["verified"]
        writes = list(api.writes)
        assert apply(api, plan, tmp_path)["changed"] is False
    new = next(row for row in api.rows if row["slug"] == "new")
    assert new["previous_id"] is None and api.rows[0]["previous_id"] == new["id"]
    assert len(api.rows) == 3
    assert api.writes == writes
    assert sum(action == "create" for action, _ in writes) == 1


def test_uncertain_completed_write_is_reconciled_without_resending(api, definition, tmp_path):
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    api.fail_after_write = True
    with patch.object(cm, "verify_backup", return_value="verified-artifact"):
        with pytest.raises(cm.Conflict, match="journal"):
            apply(api, plan, tmp_path)
    assert cm.load_json(tmp_path / "journal.json")["pending"] is not None
    assert apply(api, plan, tmp_path)["changed"] is False
    assert len(api.writes) == 1
    assert cm.load_json(tmp_path / "journal.json")["state"] == "complete"


def test_incomplete_create_timeout_is_not_retried(api, definition, tmp_path):
    definition["rows"].insert(0, {"ref": "new", "match": {"slug": "new"}, "create": True,
                                  "values": {"title": {"fi": "Uusi", "en": "New"}}})
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    api.fail_after_write = True
    with patch.object(cm, "verify_backup", return_value="verified-artifact"):
        with pytest.raises(cm.Conflict, match="journal"):
            apply(api, plan, tmp_path)
        with pytest.raises(cm.Conflict, match="incomplete journal"):
            apply(api, plan, tmp_path)
    assert len(api.writes) == 1
    assert len(api.rows) == 3


def test_readback_mismatch_stops_without_automatic_delete_or_rollback(api, definition, tmp_path):
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    api.corrupt_readback = True
    with patch.object(cm, "verify_backup", return_value="verified-artifact"):
        with pytest.raises(cm.Conflict):
            apply(api, plan, tmp_path)
    journal = cm.load_json(tmp_path / "journal.json")
    assert journal["state"] == "needs_reconciliation" and journal["pending"]
    assert len(api.writes) == 1
    with pytest.raises(cm.Conflict, match="uncertain"):
        cm.recovery_definition(journal)


def test_compensation_is_update_only_and_guarded_by_last_verified_values(api, definition, tmp_path):
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    with patch.object(cm, "verify_backup", return_value="verified-artifact"):
        apply(api, plan, tmp_path)
    recovery = cm.recovery_definition(cm.load_json(tmp_path / "journal.json"))
    assert recovery["rows"][0]["match"] == {"id": 8}
    assert recovery["rows"][0]["expect"]["enabled"] is True
    assert recovery["rows"][0]["values"]["enabled"] is False
    cm.build_plan(api, TARGET, DATASET, recovery)
    api.rows[0]["enabled"] = False
    with pytest.raises(cm.Conflict, match="expectation"):
        cm.build_plan(api, TARGET, DATASET, recovery)


def test_compensation_does_not_turn_created_rows_into_an_implicit_delete():
    with pytest.raises(cm.Conflict, match="no automatic delete"):
        cm.recovery_definition({"steps": [{"id": 30, "action": "create"}]})


def receipt_fixture(tmp_path, plan):
    artifact = tmp_path / "database.dump"
    artifact.write_bytes(b"PGDMP fixture; real pg_restore parsing is tested separately")
    receipt = {
        "target": plan["target"], "dataset": plan["dataset"], "plan_sha256": plan["plan_sha256"],
        "before_sha256": plan["before_sha256"], "created_at": datetime.now(timezone.utc).isoformat(),
        "database_name": "fixture_database", "instance_identity": "fixture-instance",
        "provenance": "operator-confirmed",
        "artifacts": [{"kind": "database", "path": str(artifact),
                       "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest()}],
    }
    path = tmp_path / "receipt.json"
    cm.write_json(path, receipt)
    return path, receipt, artifact


def test_backup_checks_real_bytes_and_invokes_archive_reader(api, definition, tmp_path):
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    path, receipt, artifact = receipt_fixture(tmp_path, plan)
    with patch.object(cm.shutil, "which", return_value="/usr/bin/pg_restore"), \
            patch.object(cm.subprocess, "run", return_value=Namespace(returncode=0)) as run:
        assert cm.verify_backup(path, plan) == cm.digest(receipt)
        assert run.call_args.args[0] == ["/usr/bin/pg_restore", "--list", str(artifact)]
        artifact.write_bytes(artifact.read_bytes() + b"drift")
        with pytest.raises(cm.Conflict, match="checksum"):
            cm.verify_backup(path, plan)


@pytest.mark.parametrize("change", ["target", "hash", "old", "old_file", "missing", "provenance"])
def test_unbound_stale_or_missing_backup_fails(api, definition, tmp_path, change):
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    path, receipt, artifact = receipt_fixture(tmp_path, plan)
    if change == "target":
        receipt["target"] = "https://other.example"
    elif change == "hash":
        receipt["plan_sha256"] = "0" * 64
    elif change == "old":
        receipt["created_at"] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    elif change == "old_file":
        os.utime(artifact, (1, 1))
    elif change == "missing":
        artifact.unlink()
    else:
        receipt["provenance"] = "guessed"
    cm.write_json(path, receipt)
    with pytest.raises(cm.Conflict):
        cm.verify_backup(path, plan)


def test_fake_dump_magic_is_not_enough_for_backup_acceptance(api, definition, tmp_path):
    if not cm.shutil.which("pg_restore"):
        pytest.skip("pg_restore unavailable")
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    path, _, _ = receipt_fixture(tmp_path, plan)
    with pytest.raises(cm.Conflict, match="not readable"):
        cm.verify_backup(path, plan)


def test_remote_credential_file_is_origin_bound_and_ambient_secrets_are_not_forwarded(tmp_path):
    path = tmp_path / "credentials.json"
    cm.write_json(path, {"target": TARGET, "username": "test-user", "password": "fixture"})
    args = Namespace(base_url=TARGET, dataset=DATASET, credentials_file=str(path), prompt_credentials=False)
    with patch.object(cm, "EaselectAPIClient") as client:
        client.return_value.is_local_native_target = False
        cm.make_client(args)
        assert client.call_args.kwargs["environment"] == {}
        assert client.call_args.kwargs["username"] == "test-user"
    args.base_url = "https://other.example"
    with pytest.raises(cm.Conflict, match="different origin"):
        cm.make_client(args)
    path.chmod(0o644)
    args.base_url = TARGET
    with pytest.raises(cm.Conflict, match="owner-only"):
        cm.make_client(args)


@pytest.mark.parametrize("target", ["http://remote.example", "https://u:p@remote.example",
                                     "https://remote.example/path", "https://remote.example?q=x"])
def test_target_is_one_verified_https_origin(target):
    with pytest.raises(cm.Conflict):
        cm.origin(target)


def test_cli_plan_stdout_contains_hashes_but_not_private_content(api, definition, tmp_path, capsys):
    source = tmp_path / "definition.json"
    cm.write_json(source, definition)
    output = tmp_path / "plan.json"
    with patch.object(cm, "make_client", return_value=api):
        assert cm.main(["plan", "--base-url", TARGET, "--dataset", DATASET,
                        "--definition", str(source), "--output", str(output)]) == 0
    stdout = capsys.readouterr().out
    assert "plan_sha256" in stdout and "Vanha" not in stdout and "Behåll" not in stdout
    assert output.stat().st_mode & 0o077 == 0


def test_stable_uid_is_not_dataset_registry_row_id(api, definition):
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    assert plan["metadata"]["table_uid"] == 51


def test_ambiguous_stable_uid_metadata_fails_closed(api, definition):
    api.details[0]["table_uid"] = 999
    with pytest.raises(cm.Conflict, match="stable table UID"):
        cm.build_plan(api, TARGET, DATASET, definition)
    assert not api.writes


def test_nullable_language_list_is_valid_for_nonlocalized_columns(api, definition):
    api.columns[0]["multilingual_languages"] = None
    assert cm.build_plan(api, TARGET, DATASET, definition)["metadata"]["columns"]["id"]["languages"] == []


def test_dataset_name_list_is_not_sufficient_authorization_metadata():
    with pytest.raises(cm.Conflict, match="registered dataset metadata"):
        cm.flatten_datasets(["sample_pages"])


@pytest.mark.parametrize(("value", "expected"), [
    ({"Valid": False, "Bool": False}, True),
    ({"Valid": True, "Bool": False}, False),
    ({"Valid": True, "Bool": True}, True),
    ({}, False),
    (None, False),
    ({"Valid": 0, "Bool": 0}, False),
])
def test_insertability_matches_nullable_api_metadata(value, expected):
    assert cm.user_insertable({"insertable": value}) is expected


def artifact_snapshot(directory):
    """Record fixture bytes and links so rejection cannot hide a mutation."""
    return {str(path.relative_to(directory)):
            ("link", os.readlink(path)) if path.is_symlink()
            else ("file", path.read_bytes())
            for path in directory.rglob("*") if path.is_file() or path.is_symlink()}


@pytest.mark.parametrize("alias", ["same", "relative", "symlink", "hardlink"])
@pytest.mark.parametrize(("action", "output_name", "input_name"), [
    ("plan", "output", "definition"),
    ("plan", "output", "credentials_file"),
    ("apply", "output", "journal"),
    ("apply", "output", "lock"),
    ("apply", "output", "plan"),
    ("apply", "output", "backup_receipt"),
    ("apply", "output", "credentials_file"),
    ("apply", "journal", "plan"),
    ("apply", "journal", "backup_receipt"),
    ("apply", "journal", "credentials_file"),
    ("apply", "lock", "plan"),
    ("recovery-definition", "output", "journal"),
])
def test_cli_artifact_aliases_fail_before_authentication_or_any_mutation(
        tmp_path, monkeypatch, alias, action, output_name, input_name):
    paths = {name: tmp_path / (name + ".json")
             for name in ("output", "definition", "credentials_file", "journal",
                          "plan", "backup_receipt")}
    paths["lock"] = Path(str(paths["journal"]) + ".lock")
    for path in paths.values():
        path.write_text('{"preserve":true}')
    target = paths[input_name]
    if alias == "same":
        aliased = target
    elif alias == "relative":
        monkeypatch.chdir(tmp_path)
        aliased = Path(target.name)
    else:
        aliased = tmp_path / ("alias.lock" if output_name == "lock" else "alias.json")
        if alias == "symlink":
            aliased.symlink_to(target)
        else:
            os.link(target, aliased)
    if output_name == "lock":
        assert str(aliased).endswith(".lock") or alias in {"same", "relative"}
        # Journal locks always add .lock; use that exact alias as the target
        # of a dedicated plan fixture when the requested spelling needs it.
        if not str(aliased).endswith(".lock"):
            lock_alias = Path(str(aliased) + ".lock")
            if alias == "same":
                paths[input_name] = lock_alias
                lock_alias.write_text('{"preserve":true}')
            else:
                paths[input_name] = lock_alias.absolute()
                lock_alias.write_text('{"preserve":true}')
            aliased = lock_alias
        paths["journal"] = Path(str(aliased)[:-5])
    else:
        paths[output_name] = aliased
    argv = [action, "--output", str(paths["output"])]
    if action == "recovery-definition":
        argv += ["--journal", str(paths["journal"])]
    else:
        argv += ["--base-url", TARGET, "--dataset", DATASET,
                 "--credentials-file", str(paths["credentials_file"])]
        if action == "plan":
            argv += ["--definition", str(paths["definition"])]
        else:
            argv += ["--plan", str(paths["plan"]), "--confirm-plan-sha256", "unused",
                     "--backup-receipt", str(paths["backup_receipt"]),
                     "--journal", str(paths["journal"])]
    before = artifact_snapshot(tmp_path)
    with patch.object(cm, "make_client") as client_factory:
        with pytest.raises(cm.Conflict, match="must not alias"):
            cm.main(argv)
        client_factory.assert_not_called()
    assert artifact_snapshot(tmp_path) == before


@pytest.mark.parametrize("alias", ["same", "relative", "symlink", "hardlink"])
def test_apply_output_cannot_clobber_a_receipt_backup_artifact(tmp_path, monkeypatch, alias):
    dump = tmp_path / "database.dump"
    dump.write_bytes(b"backup-fixture-preserve")
    receipt = tmp_path / "receipt.json"
    cm.write_json(receipt, {"artifacts": [{"kind": "database", "path": dump.name}]})
    output = dump
    if alias == "relative":
        monkeypatch.chdir(tmp_path)
        output = Path(dump.name)
    elif alias in {"symlink", "hardlink"}:
        output = tmp_path / "result.json"
        if alias == "symlink":
            output.symlink_to(dump)
        else:
            os.link(dump, output)
    before = artifact_snapshot(tmp_path)
    with patch.object(cm, "make_client") as client_factory:
        with pytest.raises(cm.Conflict, match="must not alias backup artifact"):
            cm.main(["apply", "--base-url", TARGET, "--dataset", DATASET,
                     "--plan", str(tmp_path / "plan.json"), "--confirm-plan-sha256", "unused",
                     "--backup-receipt", str(receipt), "--journal", str(tmp_path / "journal.json"),
                     "--output", str(output)])
        client_factory.assert_not_called()
    assert artifact_snapshot(tmp_path) == before


def test_distinct_cli_paths_keep_apply_noop_and_recovery_usable(api, definition, tmp_path):
    plan = cm.build_plan(api, TARGET, DATASET, definition)
    plan_file, journal = tmp_path / "plan.json", tmp_path / "journal.json"
    output, recovery = tmp_path / "result.json", tmp_path / "recovery.json"
    receipt = tmp_path / "missing-after-completion-receipt.json"
    cm.write_json(plan_file, plan)
    argv = ["apply", "--base-url", TARGET, "--dataset", DATASET,
            "--plan", str(plan_file), "--confirm-plan-sha256", plan["plan_sha256"],
            "--backup-receipt", str(receipt), "--journal", str(journal), "--output", str(output)]
    with patch.object(cm, "make_client", return_value=api), \
            patch.object(cm, "verify_backup", return_value="fixture-backup") as verify:
        assert cm.main(argv) == 0
        assert cm.main(argv) == 0
        assert verify.call_count == 1
    assert len(api.writes) == 1
    assert cm.load_json(journal)["state"] == "complete"
    assert len(cm.load_json(journal)["steps"]) == 1
    assert cm.load_json(output)["changed"] is False
    assert cm.main(["recovery-definition", "--journal", str(journal),
                    "--output", str(recovery)]) == 0
    assert cm.load_json(recovery)["rows"][0]["values"]["enabled"] is False
    assert cm.load_json(journal)["steps"]
    assert not Path(str(journal) + ".lock").exists()


def test_same_absent_journal_and_output_are_rejected_before_creation(tmp_path):
    shared = tmp_path / "not-yet-created.json"
    with patch.object(cm, "make_client") as client_factory:
        with pytest.raises(cm.Conflict, match="must not alias journal"):
            cm.main(["apply", "--base-url", TARGET, "--dataset", DATASET,
                     "--plan", str(tmp_path / "plan.json"), "--confirm-plan-sha256", "unused",
                     "--backup-receipt", str(tmp_path / "receipt.json"),
                     "--journal", str(shared), "--output", str(shared)])
        client_factory.assert_not_called()
    assert list(tmp_path.iterdir()) == []
