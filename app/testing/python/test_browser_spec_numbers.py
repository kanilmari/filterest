"""test_browser_spec_numbers.py
Guard category numbers across tracked browser tests, including separate configs.
Connect the Git inventory to exact, documented legacy collision allowances.
Keep new browser tests from silently sharing an existing spec's identity.
"""

from collections import defaultdict
from pathlib import Path, PurePosixPath
import re
import subprocess
from typing import Iterable

import pytest


ROOT = Path(__file__).resolve().parents[3]
E2E = "app/testing/e2e/"
# Count .test.ts too: these are browser tests even when a separate config runs
# them (L4 cookie isolation). Shell fixtures and other non-spec helpers do not count.
SPEC_NUMBER = re.compile(r"^([A-Z]+[0-9]+)(?=[_.])")
LEGACY_COLLISIONS = {
    "G4": {  # 9.0.0 export; referenced by tickets
        E2E + "G_navigation/G4_history_back.spec.ts",
        E2E + "G_navigation/G4_svg_tab_alignment.spec.ts",
    },
    "L4": {  # 9.0.0 export; referenced by tickets
        E2E + "L_auth/L4_forced_login_page.spec.ts",
        E2E + "L_auth/L4_instance_cookie_isolation.test.ts",
        E2E + "L_auth/L4_user_profile_fetch.spec.ts",
    },
    "T11": {  # 9.0.0 export; referenced by tickets
        E2E + "T_admin/T11_site_language_embedding_and_field_view.spec.ts",
        E2E + "T_admin/T11_storage_root_cleanup.spec.ts",
    },
    "T13": {  # 9.0.0 export; referenced by tickets
        E2E + "T_admin/T13_media_subfolder_bulk_check.spec.ts",
        E2E + "T_admin/T13_workline_observatory.spec.ts",
    },
}


def assert_unique_spec_numbers(paths: Iterable[str]) -> None:
    """Accept only a unique number or an exact historical collision group."""
    by_number = defaultdict(set)
    for path in paths:
        if not path.startswith(E2E) or not path.endswith((".spec.ts", ".test.ts")):
            continue
        match = SPEC_NUMBER.match(PurePosixPath(path).name)
        if match:
            by_number[match[1]].add(path)
    collisions = {
        number: sorted(files) for number, files in sorted(by_number.items())
        if len(files) > 1 and files != LEGACY_COLLISIONS.get(number)
    }
    assert not collisions, "Shared browser spec numbers:\n" + "\n".join(
        f"{number}: {', '.join(files)}" for number, files in collisions.items()
    )


def test_tracked_browser_spec_numbers_are_unique():
    # Tracked plus not-ignored new files that exist on disk: a batch is tested before its commit, so renamed specs are
    # still untracked and their old paths still in the index. Ignored/generated files stay out.
    # Git failures propagate: a missing inventory must never become a passing guard.
    listed = subprocess.run(
        ["git", "ls-files", "--full-name", "-z", "--cached", "--others", "--exclude-standard", "--", E2E],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout.split("\0")
    top = Path(subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=ROOT, check=True,
                              capture_output=True, text=True).stdout.strip())
    inventory = sorted({path for path in listed if path and (top / path).is_file()})
    assert any(path.endswith(".spec.ts") for path in inventory), "No tracked browser specs"
    assert_unique_spec_numbers(inventory)


def test_distinct_letters_numbers_and_multiple_letter_categories_are_unique():
    assert_unique_spec_numbers([
        E2E + "nested/T1_first.spec.ts",
        E2E + "nested/T11_second.spec.ts",
        E2E + "other/C1_third.spec.ts",
        E2E + "other/AB12_fourth.spec.ts",
    ])


@pytest.mark.parametrize("number", ["C18", "T15", "T16", "AB12"])
def test_new_collision_fails_across_directories(number):
    paths = [E2E + f"first/{number}_one.spec.ts", E2E + f"nested/second/{number}_two.spec.ts"]
    with pytest.raises(AssertionError, match=number) as failure:
        assert_unique_spec_numbers(paths)
    assert all(path in str(failure.value) for path in paths)


@pytest.mark.parametrize("number", sorted(LEGACY_COLLISIONS))
def test_exact_legacy_collision_is_allowed(number):
    assert_unique_spec_numbers(LEGACY_COLLISIONS[number])


@pytest.mark.parametrize("number", sorted(LEGACY_COLLISIONS))
def test_extra_file_on_legacy_number_fails(number):
    # A third file fails for the old pairs; L4 already has three, so its fourth fails.
    paths = [*LEGACY_COLLISIONS[number], E2E + f"nested/{number}_new.spec.ts"]
    with pytest.raises(AssertionError, match=number):
        assert_unique_spec_numbers(paths)


@pytest.mark.parametrize("number", sorted(LEGACY_COLLISIONS))
def test_same_basename_in_another_directory_is_not_allowlisted(number):
    paths = sorted(LEGACY_COLLISIONS[number])
    paths[0] = E2E + "other/" + PurePosixPath(paths[0]).name
    with pytest.raises(AssertionError, match=number):
        assert_unique_spec_numbers(paths)


@pytest.mark.parametrize("suffix", ["spec.ts", "test.ts"])
def test_test_ts_shares_the_number_namespace(suffix):
    with pytest.raises(AssertionError, match="T20"):
        assert_unique_spec_numbers([
            E2E + "nested/T20_one.test.ts", E2E + f"other/T20_two.{suffix}",
        ])


def test_non_spec_helpers_unnumbered_specs_and_other_trees_do_not_count():
    assert_unique_spec_numbers([
        E2E + "T_admin/T18_custom_root_page.spec.ts",
        E2E + "T_admin/T18_custom_root_fixture.sh",
        E2E + "helpers/T18_helper.ts",
        E2E + "helpers/T18_helper.spec.ts.bak",
        E2E + "setup/auth.setup.ts",
        E2E + "smoke.spec.ts",
        E2E + "nested/smoke.spec.ts",
        "app/frontend/T_admin/T18_other.test.ts",
    ])
