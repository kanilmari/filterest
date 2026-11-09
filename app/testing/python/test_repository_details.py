"""Test one-field repository relocation without network, publication or real updates.

Proves Go/Python source ownership, standalone-source packaging, CLI failure and
lifecycle refusal before a stale or unapproved origin can be used.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import re

import pytest

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
from server_tools.lib.repository_details import (RepositoryDetails, RepositoryDetailsError,
    REPOSITORY_DETAILS_DIAGNOSTIC, load_repository_details)
from native_lifecycle_fixture import (build_update_fixture, git_output, logged_calls, run_update,
    update_backups, clean_filterest_environment, copy_lifecycle_libraries, INSTALLER, source_snapshot)
from repository_transport_fixture import install_repository_transport


@pytest.mark.parametrize("host", ["github.com", "code.example.test"])
def test_addresses_follow_all_three_fields(host):
    details = RepositoryDetails(host, "new-owner", "project")
    web = f"https://{host}/new-owner/project"
    api = "https://api.github.com" if host == "github.com" else f"https://{host}/api/v3"
    assert details.web_url == web
    assert details.git_url == web + ".git"
    assert details.api_url == api + "/repos/new-owner/project"
    assert details.release_api_url() == details.api_url + "/releases/latest"
    assert details.release_api_url("v1.2.3") == details.api_url + "/releases/tags/v1.2.3"
    assert details.download_url("v1.2.3") == web + "/releases/download/v1.2.3"
    assert details.release_url("v1.2.3") == web + "/releases/tag/v1.2.3"
    assert len(details.remote_urls()) == 4
    assert all("new-owner/project" in value for value in details.remote_urls())
    assert "%2F" in details.release_url("tag/with/slash")


@pytest.mark.parametrize("bad", [
    "null", "[]", "{}", '{"host":"github.com","owner":"a","owner":"b","repo":"r"}',
    '{"host":"github.com","owner":"a","repo":"r","extra":1}',
    '{"host":"github.com:443","owner":"a","repo":"r"}',
    '{"host":"github.com","owner":false,"repo":"r"}',
    '{"host":"github.com","owner":"a/b","repo":"r"}',
    '{"host":"github.com","owner":"a","repo":".."}',
    '{"host":"github.com","owner":"a","repo":"r"} {}',
])
def test_invalid_metadata_has_no_fallback(tmp_path, bad):
    path = tmp_path / "repo_details.json"
    path.write_text(bad)
    with pytest.raises((ValueError, TypeError)):
        load_repository_details(path)


def test_copied_source_tools_follow_one_owner_edit_and_fail_if_missing(tmp_path):
    tools = tmp_path / "app/server_tools"
    (tools / "release").mkdir(parents=True)
    (tools / "lib").mkdir()
    for name in ["lib/repository_details.py", "repo_details.json", "release/publish_release.py", "release/github_actions_policy.py"]:
        shutil.copy2(APP_ROOT / "server_tools" / name, tools / name)
    identity = json.loads((tools / "repo_details.json").read_text())
    identity["owner"] = "future-owner"
    (tools / "repo_details.json").write_text(json.dumps(identity))
    for field, argument, expected in [
        ("git", "", "https://github.com/future-owner/filterest.git"),
        ("release-api", "v1.2.3", "https://api.github.com/repos/future-owner/filterest/releases/tags/v1.2.3"),
        ("download", "v1.2.3", "https://github.com/future-owner/filterest/releases/download/v1.2.3"),
    ]:
        result = subprocess.run([sys.executable, "-B", str(tools / "lib/repository_details.py"), field, argument], capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == expected
    # Import the real publisher from the copied source; no gh invocation occurs.
    result = subprocess.run([sys.executable, "-B", "-c",
        "from server_tools.release import publish_release as publisher; "
        "DETAILS = publisher.load_repository_details(); "
        "assert DETAILS.owner == 'future-owner'; assert DETAILS.repository == 'future-owner/filterest'; "
        "assert DETAILS.git_url == 'https://github.com/future-owner/filterest.git'; "
        "calls = []; publisher.command = lambda args, **kwargs: calls.append(args); "
        "publisher.GitHub().upload('v1.2.3', []); "
        "assert calls[0][-2:] == ['--repo', 'github.com/future-owner/filterest']"],
        cwd=tools.parent, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    (tools / "repo_details.json").unlink()
    result = subprocess.run([sys.executable, "-B", str(tools / "lib/repository_details.py"), "git"], capture_output=True, text=True)
    assert result.returncode != 0 and not result.stdout


def test_release_consumers_follow_one_repository_file(tmp_path):
    repository = {"host": "code.example.test", "owner": "future-owner", "repo": "relocated"}
    fixture = build_update_fixture(tmp_path, "admin", real_native_installer=True, repository=repository)
    checkout = fixture["checkout"]
    app = checkout / "app"
    tools = app / "server_tools"
    web = "https://code.example.test/future-owner/relocated"
    api = "https://code.example.test/api/v3/repos/future-owner/relocated"

    # Real updater, bare local origin and recording curl. No remote transport is allowed.
    update = run_update(fixture, "--dry-run")
    assert update.returncode == 0, update.stderr
    assert "curl " + api + "/releases/latest" in logged_calls(fixture)
    assert "future-owner/relocated" in update.stdout

    install = subprocess.run(["bash", str(tools / "install_filterest.sh"), "--profile", "admin",
                              "--yes", "--dry-run", "--no-start"], cwd=checkout,
                             env=fixture["environment"], capture_output=True, text=True)
    assert install.returncode == 0, install.stderr
    assert "[dry-run] download " + web + "/releases/download/v8.50.0/filterest-linux-" in install.stdout

    # Add the real source consumers to the same disposable tree after the updater's clean-tree check.
    for name in ("go.mod", "server_tools/repository_details.go", "server_tools/release/publish_release.py",
                 "server_tools/release/github_actions_policy.py",
                 "backend/core_components/release_updates/latest_stable_release_checker.go",
                 "backend/core_components/release_updates/latest_stable_release_checker_test.go"):
        dest = app / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(APP_ROOT / name, dest)

    # Only these standard-library packages are needed to rebuild the embedded identity.
    go_env = {**os.environ, "GOWORK": "off", "GOTOOLCHAIN": "local", "GOPROXY": "off", "GOSUMDB": "off"}
    go = subprocess.run(["go", "test", "-v", "-count=1", "./backend/core_components/release_updates",
                         "-run", "^TestDefaultCheckerUsesEmbeddedReleaseSource$"],
                        cwd=app, env=go_env, capture_output=True, text=True)
    assert go.returncode == 0, go.stdout + go.stderr
    assert "requested " + api + "/releases/latest and returned " + web + "/releases/tag/v8.30.1" in go.stdout

    for field, argument, expected in [
        ("git", "", web + ".git"),
        ("release-api", "v1.2.3", api + "/releases/tags/v1.2.3"),
        ("download", "v1.2.3", web + "/releases/download/v1.2.3"),
    ]:
        result = subprocess.run([sys.executable, "-B", str(tools / "lib/repository_details.py"), field, argument],
                                capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == expected
    # Record the real publisher's target without running gh.
    result = subprocess.run([sys.executable, "-B", "-c",
        "from server_tools.release import publish_release as publisher; "
        "DETAILS = publisher.load_repository_details(); "
        "assert DETAILS.owner == 'future-owner'; assert DETAILS.repository == 'future-owner/relocated'; "
        "assert DETAILS.git_url == 'https://code.example.test/future-owner/relocated.git'; "
        "calls = []; publisher.command = lambda args, **kwargs: calls.append(args); "
        "publisher.GitHub().upload('v1.2.3', []); "
        "assert calls[0][-2:] == ['--repo', 'code.example.test/future-owner/relocated']"],
        cwd=app, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    (tools / "repo_details.json").unlink()
    result = subprocess.run([sys.executable, "-B", str(tools / "lib/repository_details.py"), "git"],
                            capture_output=True, text=True)
    assert result.returncode != 0 and not result.stdout


@pytest.mark.parametrize("profile", ["docker", "admin", "development"])
@pytest.mark.parametrize("problem", [
    "old-origin", "zero-origins", "extra-origin", "rewrite", "userinfo", "override", "missing-details",
])
def test_updater_refuses_unapproved_source_before_release_fetch_or_downtime(tmp_path, problem, profile):
    fixture = build_update_fixture(tmp_path, profile)
    checkout = fixture["checkout"]
    extra = {}
    expected_commit = fixture["old_commit"]
    details = load_repository_details()
    if problem == "old-origin":
        git_output(checkout, "remote", "set-url", "origin", "https://example.invalid/previous/filterest.git")
    elif problem == "zero-origins":
        git_output(checkout, "remote", "remove", "origin")
    elif problem == "extra-origin":
        git_output(checkout, "remote", "set-url", "--add", "origin", "https://example.invalid/extra/filterest.git")
    elif problem == "rewrite":
        git_output(checkout, "remote", "set-url", "origin", details.git_url)
        git_output(checkout, "config", "url.https://example.invalid/redirect/.insteadOf", details.web_url)
    elif problem == "userinfo":
        git_output(checkout, "remote", "set-url", "origin",
                   "https://synthetic-user@" + details.host + "/" + details.repository + ".git")
    elif problem == "override":
        extra["FILTEREST_RELEASE_REPOSITORY"] = "previous-owner/filterest"
    else:
        # Commit only in the disposable fixture so cleanliness cannot mask parsing.
        (checkout / "app/server_tools/repo_details.json").unlink()
        git_output(checkout, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                   "commit", "-am", "fixture without repository settings")
        expected_commit = git_output(checkout, "rev-parse", "HEAD")
    assert git_output(checkout, "status", "--porcelain", "--untracked-files=no") == ""
    before_calls = logged_calls(fixture)
    completed = run_update(fixture, "--dry-run", extra_environment=extra)
    assert completed.returncode != 0
    output = completed.stdout + completed.stderr
    assert "tracked files have local changes" not in output
    if problem == "missing-details":
        assert "Invalid or unavailable repository identity" in output
    else:
        assert "origin" in output or "override is not approved" in output
    assert str(tmp_path) not in output and "synthetic-user" not in output
    assert logged_calls(fixture) == before_calls
    assert update_backups(fixture) == []
    assert git_output(checkout, "rev-parse", "HEAD") == expected_commit


def repository_source_copies(root, details):
    """Return tracked paths which duplicate a repository address."""
    # Keep the previous public identity detectable after an authorised source change.
    # Match relocation forms as whole path components, including the Git clone suffix.
    previous_owner, previous_repo = "kanilmari", "filterest"
    repositories = {details.repository, previous_owner + "/" + previous_repo}
    slugs = "|".join(re.escape(name) for name in sorted(repositories))
    owners = "|".join(re.escape(owner) for owner in sorted({details.owner, previous_owner}))
    hosts = "|".join(re.escape(host) for host in sorted({details.host, "github.com"}))
    web = rf"(?:{hosts})/(?:api/v3/repos/)?"
    github = r"(?:api\.github\.com/repos/|(?:raw\.githubusercontent\.com|codeload\.github\.com)/)"
    # A bare slug can be a gh argument. Inside a URL match it only in a repository position.
    prefix = rf"(?:(?:https?://|ssh://git@)?{web}|(?:https?://)?{github}|git@(?:{hosts}):|/?repos/|/)?"
    pattern = (rf"(?<![a-z0-9_./:-]){prefix}(?:{slugs})(?:\.git)?(?![a-z0-9_.-])"
               rf"""|\b(?:owner|(?:github|release|repo(?:sitory)?)[_-]?owner|release[_-]?repository)["']?"""
               rf"""\s*(?::=|=|:)\s*["'](?:{owners})["']""")
    # Retain main's URL-prefix and owner-assignment checks alongside relocation forms.
    owner, host, repo = map(re.escape, (details.owner, details.host, details.repo))
    pattern += (rf"|(https://({host}/|api\.{host}/repos/)|git@{host}:){owner}/{repo}"
                rf"|\b(OWNER|RELEASE_REPOSITORY)\s*=\s*['\"]{owner}(['\"]|/)")
    excludes = ["*.key", "*.pem", "*.env", ".env*", "*credential*", "*secret*", "*token*", "*password*", "*passwd*", "*creds*"]
    excluded = [":(exclude)CHANGELOG.md", ":(exclude)**/CHANGELOG.md",
                ":(exclude)app/server_tools/repo_details.json"]
    excluded += [":(exclude,icase)" + name for name in excludes]
    result = subprocess.run(["git", "grep", "-I", "-i", "-l", "-P", pattern, "--", ".", *excluded],
                            cwd=root, capture_output=True, text=True)
    assert result.returncode in (0, 1), result.stderr
    return set(result.stdout.splitlines())


def test_active_owner_literal_has_one_source():
    assert not (copies := repository_source_copies(APP_ROOT.parent, load_repository_details())), sorted(copies)


@pytest.mark.parametrize("details", [RepositoryDetails("code.example.test", "future-owner", "relocated"),
                                     RepositoryDetails("github.com", "filterest", "filterest")])
def test_repository_guard_retains_previous_source_when_settings_change(tmp_path, details):
    old_owner, old_repo = "kanilmari", "filterest"
    old = old_owner + "/" + old_repo
    matches = {
        "app/server_tools/example.sh": f'gh release view --repo {old}',
        "app/backend/raw.go": f'const source = "https://raw.githubusercontent.com/{old}/main/version"',
        "app/server_tools/status.sh": f'gh api repos/{old}/releases/latest',
        "app/server_tools/clone.sh": f'git clone git@github.com:{old}.git',
        "app/components/clone.js": f'const git = "ssh://git@github.com/{old}.git"',
        "app/frontend/source.js": f'const source = "{old.upper()}"',
        "app/server_tools/source.py": f'repository = "{details.repository}"',
        "app/server_tools/defaults.py": f'OWNER = "{old_owner}"',
        "app/server_tools/override.sh": f'RELEASE_REPOSITORY="{details.owner}/other-project"',
        "README.md": details.release_url("v1.2.3"),
        "AUTHORS.md": f'Project credit: {old}',
        "app/backend/example_test.go": f'// Historical test fixture: {old}',
        "app/testing/python/test_source.py": f'previous = "{old}"',
        "app/similar.sh": details.web_url + '-fixtures',
    }
    allowed = {
        "app/server_tools/repo_details.json": json.dumps(details.__dict__),
        "CHANGELOG.md": f'https://github.com/{old}/releases/tag/v1.0.0',
        "app/backend/similar.go": f'// Compare https://github.com/{old}-fixtures and team-{old}',
        "app/components/names.js": '// Author: kanilmari. The product is Filterest.',
        "SECURITY.md": f'dev.example.test/Tenant/{details.repository}/service:user:42',
    }
    for name, content in (matches | allowed).items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content + "\n")
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    assert repository_source_copies(tmp_path, details) == set(matches)


@pytest.fixture
def copied_tools(tmp_path):
    tools = tmp_path / "app/server_tools"
    for name in ("lib/repository_details.py", "repo_details.json",
                 "release/publish_release.py", "release/github_actions_policy.py"):
        destination = tools / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(APP_ROOT / "server_tools" / name, destination)
    return tools


def break_details(tools, problem):
    path = tools / "repo_details.json"
    if problem == "missing":
        path.unlink()
    elif problem == "unreadable":
        # A directory produces a read error even when tests run with elevated UID.
        path.unlink()
        path.mkdir()
    elif problem == "extra-key":
        value = json.loads(path.read_text())
        value["extra"] = "untrusted-input-must-not-be-echoed"
        path.write_text(json.dumps(value))
    else:
        path.write_text("untrusted-input-must-not-be-echoed {")


@pytest.mark.parametrize("problem", ["missing", "unreadable", "malformed", "extra-key"])
@pytest.mark.parametrize("entry", ["lib/repository_details.py", "release/publish_release.py",
                                   "release/github_actions_policy.py"])
def test_python_clis_refuse_bad_details_without_paths_or_tracebacks(copied_tools, problem, entry):
    break_details(copied_tools, problem)
    arguments = {
        "lib/repository_details.py": ["git"],
        "release/publish_release.py": ["--expect-version", "1.2.3", "--published-commit", "a" * 40,
                                       "--assets-dir", "unused"],
        "release/github_actions_policy.py": ["--owner", "fixture"],
    }[entry]
    # Independently forbid external commands if a metadata guard regresses.
    script = '''import runpy, subprocess, sys
subprocess.run = lambda *a, **k: sys.exit("unexpected external command")
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name="__main__")'''
    result = subprocess.run([sys.executable, "-B", "-c", script,
                             str(copied_tools / entry), *arguments], capture_output=True, text=True)
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr == REPOSITORY_DETAILS_DIAGNOSTIC + "\n"


@pytest.mark.parametrize("module", ["github_actions_policy", "publish_release"])
def test_import_does_not_read_repository_details(copied_tools, module):
    (copied_tools / "repo_details.json").unlink()
    script = '''from pathlib import Path
import importlib
from server_tools.lib import repository_details

def forbidden(*args, **kwargs):
    raise AssertionError("metadata was read during import")
repository_details.load_repository_details = forbidden
Path.read_bytes = forbidden
Path.read_text = forbidden
importlib.import_module("server_tools.release." + MODULE)
'''.replace("MODULE", repr(module))
    result = subprocess.run([sys.executable, "-B", "-c", script], cwd=copied_tools.parent,
                            capture_output=True, text=True)
    assert result.returncode == 0, "module import must not load repository details"
    assert result.stdout == result.stderr == ""


def test_unreadable_metadata_exception_is_safe(monkeypatch):
    def denied(*args, **kwargs):
        raise PermissionError("private-location-must-not-escape")
    monkeypatch.setattr(Path, "read_bytes", denied)
    with pytest.raises(RepositoryDetailsError) as caught:
        load_repository_details()
    assert str(caught.value) == REPOSITORY_DETAILS_DIAGNOSTIC
    assert caught.value.__suppress_context__


@pytest.mark.parametrize("problem", ["missing", "unreadable", "malformed", "extra-key"])
@pytest.mark.parametrize("route", ["development", "current", "local", "download",
                                    "dependencies-only", "update-preflight"])
def test_installer_validates_before_any_machine_or_binary_step(tmp_path, problem, route):
    root = tmp_path / "installation"
    tools = root / "app/server_tools"
    tools.mkdir(parents=True)
    copy_lifecycle_libraries(root / "app")
    shutil.copy2(INSTALLER, tools / "install_filterest.sh")
    (root / "app/VERSION_APP").write_text("1.2.3\n")
    # Set up the current/local shortcuts before invalidating metadata.
    binary = root / "data/runtime/bin/filterest-server"
    binary.parent.mkdir(parents=True)
    binary.write_text("#!/bin/sh\nexit 0\n")
    binary.chmod(0o755)
    (binary.parent.parent / "filterest-binary-version").write_text("1.2.3\n")
    if route != "current":
        binary.unlink()
    local_binary = tmp_path / "reviewed-binary"
    local_binary.write_text("#!/bin/sh\nexit 0\n")
    break_details(tools, problem)
    before = source_snapshot(root)
    calls = tmp_path / "calls"
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    for name in ("apt-get", "sudo", "curl", "wget", "go", "npm", "systemctl", "kill", "pg_ctl"):
        command = fake_bin / name
        command.write_text('#!/bin/sh\nprintf "external-step\\n" >> "$TEST_CALLS"\nexit 97\n')
        command.chmod(0o755)
    environment = clean_filterest_environment(root)
    environment.update(FILTEREST_INSTALLER_LIBRARY_ONLY="1", TEST_INSTALLER=str(tools / "install_filterest.sh"),
                       TEST_CALLS=str(calls), PATH=str(fake_bin) + os.pathsep + os.environ["PATH"])
    if route == "local":
        environment["FILTEREST_BINARY_SOURCE"] = str(local_binary)
    arguments = ["--profile", "development" if route in {"development", "dependencies-only"} else "admin",
                 "--yes", "--no-start"]
    if route in {"dependencies-only", "update-preflight"}:
        arguments.append("--" + route)
    script = '''source "$TEST_INSTALLER"
blocked_step() { printf 'machine-or-binary-step\\n' >> "$TEST_CALLS"; exit 98; }
install_host_packages() { blocked_step; }
install_go_toolchain_if_needed() { blocked_step; }
install_node_toolchain_if_needed() { blocked_step; }
configure_environment_files() { blocked_step; }
stop_stale_checkout_server_before_install() { blocked_step; }
ensure_admin_binary() { blocked_step; }
main "$@"'''
    result = subprocess.run(["bash", "-euc", script, "fixture", *arguments], env=environment,
                            capture_output=True, text=True)
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr == REPOSITORY_DETAILS_DIAGNOSTIC + "\n"
    assert not calls.exists()
    assert source_snapshot(root) == before


@pytest.mark.parametrize("address", ["https://example.invalid/unavailable.git",
                                     "ssh://git@example.invalid/unavailable.git",
                                     "git@example.invalid:unavailable.git"])
def test_transport_fixture_blocks_network_even_without_product_validation(tmp_path, address):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    install_repository_transport(fake_bin, tmp_path / "origin.git")
    root = tmp_path / "checkout"
    subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
    environment = {**os.environ, "GIT_ALLOW_PROTOCOL": "https:ssh"}
    result = subprocess.run([str(fake_bin / "git"), "-C", str(root), "fetch", address],
                            env=environment, capture_output=True, text=True, timeout=10)
    assert result.returncode != 0
    assert "unavailable-transport" in result.stderr
    assert "Could not resolve" not in result.stderr
    assert "connect to host" not in result.stderr
