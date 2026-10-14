"""test_reviewed_provenance_hashes.py
Check the exact file bytes recorded in both reviewed provenance registers.
Connect release asset and browser-license reviews to the ordinary Python tier.
Catch edits and removals before a release or private maintenance audit.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from server_tools.public_slice_export import generate_third_party_notices as notices


ROOT = Path(__file__).resolve().parents[3]


def reviewed_files() -> list[tuple[str, str, str]]:
    """Read every recorded digest, using the release generator's path conventions."""
    assets = notices.read_asset_provenance(ROOT)
    browser = notices.read_browser_bundle_provenance(ROOT)
    records = [
        (str(notices.ASSET_PROVENANCE_PATH), row["path"], row["sha256"])
        for row in assets["files"]
    ]
    assert records, "asset provenance must list reviewed files"
    for component in browser["components"]:
        assert component["documents"], "browser provenance must list reviewed documents"
        records.extend(
            (str(notices.BROWSER_BUNDLE_PROVENANCE_PATH),
             "app/server_tools/licenses/" + row["path"], row["sha256"])
            for row in component["documents"]
        )
    return records


REVIEWED_FILES = reviewed_files()


def assert_reviewed_file(root: Path, register: str, relative: str, expected: str) -> None:
    """Refuse missing or changed reviewed bytes with an actionable review instruction."""
    path = root / relative
    instruction = f"Re-review the file and update its entry in {register}."
    assert path.is_file() and not path.is_symlink(), (
        f"Reviewed provenance file is missing or not regular: {relative}. {instruction}"
    )
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    assert actual == expected, (
        f"Reviewed provenance hash changed: {relative}; expected {expected}, "
        f"got {actual}. {instruction}"
    )


@pytest.mark.parametrize("register,relative,expected", REVIEWED_FILES,
                         ids=[row[1] for row in REVIEWED_FILES])
def test_reviewed_provenance_file_matches_recorded_sha256(register, relative, expected):
    assert_reviewed_file(ROOT, register, relative, expected)


@pytest.mark.parametrize("register,relative,expected", REVIEWED_FILES,
                         ids=[row[1] for row in REVIEWED_FILES])
@pytest.mark.parametrize("change", ["changed", "missing"])
def test_every_reviewed_path_rejects_drift_and_removal(tmp_path, register, relative, expected, change):
    # Mirror each real path in an isolated tree; never mutate the reviewed source.
    path = tmp_path / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"reviewed fixture bytes")
    expected = hashlib.sha256(path.read_bytes()).hexdigest()
    assert_reviewed_file(tmp_path, register, relative, expected)
    if change == "changed":
        path.write_bytes(b"unreviewed fixture bytes")
    else:
        path.unlink()
    with pytest.raises(AssertionError) as failure:
        assert_reviewed_file(tmp_path, register, relative, expected)
    assert relative in str(failure.value)
    assert register in str(failure.value)
    assert "Re-review the file and update its entry" in str(failure.value)
