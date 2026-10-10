"""database_recovery_update.py: authenticate complete updates before downtime.

Connects the updater's final completion record with read-only operator verification
and bounded extraction into a fresh staging folder; database-only packets stay separate.
"""
from __future__ import annotations

# Direct commands get a fixed import refusal before any path-bearing traceback.
if __name__ == "__main__":
    try:
        import sys
        from recovery_process_boundary import python_entrypoint
        python_entrypoint(__file__)
    except SystemExit:
        raise
    except BaseException:
        sys.stderr.write("Recovery entrypoint unavailable; sensitive details withheld.\n")
        sys.exit(1)

from contextlib import redirect_stdout
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile

if __package__:
    from . import database_recovery as recovery
    from .recovery_key_safety import KeyScanner, reject_key_bytes, reject_key_name
    from .recovery_archives import (ARCHIVE_ROOTS, create_archives, preflight_archives,
        verify_archive, extract_archive, directory_descriptor, restore_staged_roots, verify_native_home, verify_root_link_policy)
else:
    import database_recovery as recovery
    from recovery_key_safety import KeyScanner, reject_key_bytes, reject_key_name
    from recovery_archives import (ARCHIVE_ROOTS, create_archives, preflight_archives,
        verify_archive, extract_archive, directory_descriptor, restore_staged_roots, verify_native_home, verify_root_link_policy)

RECORD = "update.backup.json"
MANIFEST = "manifest.txt"


def update_mac(record: dict, key: bytes) -> str:
    unsigned = {name: value for name, value in record.items() if name != "mac"}
    return hmac.new(key, b"filterest-update-packet-v1\0" + recovery.canonical(unsigned), hashlib.sha256).hexdigest()


def present(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def packet_files(folder: Path, database: dict) -> set[str]:
    return {database["dump"], *database["files"], recovery.RECORD, recovery.CHECKSUMS, MANIFEST} | {
        name for name in ARCHIVE_ROOTS if present(folder / name)}


def verify_manifest(folder: Path, profile: str, *, legacy=False) -> str | None:
    recovery.regular_file(folder / MANIFEST, protected=True)
    text = (folder / MANIFEST).read_text()
    profiles = re.findall(r"^profile=(.*)$", text, re.M)
    if not legacy and (profiles != ["docker"] if profile == "docker" else len(profiles) != 1 or profiles[0] not in ("admin", "development")):
        raise recovery.RecoveryError("Update manifest does not match the installation profile")
    commits = re.findall(r"^source_commit=(.*)$", text, re.M)
    if not legacy and (len(commits) != 1 or not re.fullmatch(r"[0-9a-f]{40}(?:[0-9a-f]{24})?", commits[0])):
        raise recovery.RecoveryError("Update manifest requires one previous source commit")
    return commits[0] if not legacy else None


@recovery.recovery_operation
def verify_update(folder: Path, root: Path, profile: str, paths: list[Path], *, legacy=False, return_source_commit=False) -> dict | str | None:
    """Authenticate a private snapshot without changing the installation or packet."""
    key = recovery.packet_key(root, profile, paths) if present(root / "keys" / recovery.KEY) else None
    with recovery.private_diagnostics("verify-update", packet=folder, key=key) as logs:
        snapshot = recovery.snapshot_packet(folder, logs / ("update_snapshot" if folder.name.startswith("update_") else "packet_snapshot"), key,
            record_check=(RECORD, lambda path: authenticated_update_record(path, profile, key)))
        record = _verify_update_snapshot(snapshot, root, profile, paths, legacy=legacy)
        # Export rollback metadata while the authenticated capture still exists.
        # No consumer may reopen the operator's manifest for a source selector.
        if return_source_commit:
            if record is None:
                raise recovery.RecoveryError("Previous source commit is unavailable: legacy manifests are unauthenticated; recover the commit independently from trusted source history")
            return verify_manifest(snapshot, profile)
        return record


def authenticated_update_record(path: Path, profile: str, key) -> dict:
    """Authenticate captured metadata before decoding archives or trusting names."""
    record = json.loads(path.read_text())
    if not isinstance(record, dict):
        raise recovery.RecoveryError("Update completion record must be an object")
    if record.get("format_version") != 1 or record.get("profile") != profile:
        raise recovery.RecoveryError("Update packet format or profile does not match")
    if key is None or not isinstance(record.get("mac"), str) or not hmac.compare_digest(record["mac"], update_mac(record, key)):
        raise recovery.RecoveryError("Whole-update packet authentication failed; installation unchanged")
    return record


@recovery.recovery_operation
def _verify_update_snapshot(folder: Path, root: Path, profile: str, paths: list[Path], *, legacy=False) -> dict | None:
    """Check digests, metadata and archive members against the same captured bytes."""
    verify_root_link_policy(root, profile)
    recovery.private_folder(folder, writable=False)
    if any(path.name.endswith(".partial") for path in folder.iterdir()):
        raise recovery.RecoveryError("Update packet is incomplete")
    record_path = folder / RECORD
    if not present(record_path):
        if not legacy:
            raise recovery.RecoveryError("Whole-update completion record is missing; only a known older packet may use --legacy")
        database = recovery._verify_packet_snapshot(folder, root, profile, paths, allow_legacy=True, match_settings=False)
        # A missing final seal on a current packet must never downgrade to old recovery.
        if database and database["format_version"] == 2:
            raise recovery.RecoveryError("Partial update packet: an authenticated database packet lacks its whole-update completion record")
        recovery.legacy_manifest(folder, root, profile)
        verify_manifest(folder, profile, legacy=True)
        key = recovery.packet_key(root, profile, paths) if present(root / "keys" / recovery.KEY) else None
    else:
        recovery.regular_file(record_path, protected=True)
        key = recovery.packet_key(root, profile, paths)
        record = authenticated_update_record(record_path, profile, key)
        files = record.get("files")
        if not isinstance(files, dict):
            raise recovery.RecoveryError("Update packet has no authenticated artifact list")
        # Authenticate the database record before trusting its artifact names.
        recovery.regular_file(folder / recovery.RECORD, protected=True)
        if recovery.digest(folder / recovery.RECORD) != files.get(recovery.RECORD):
            raise recovery.RecoveryError("Update packet checksum failed: database completion record")
        database = recovery._verify_packet_snapshot(folder, root, profile, paths, match_settings=False)
        if database["format_version"] != 2 or set(files) != packet_files(folder, database):
            raise recovery.RecoveryError("Update packet contains missing or unauthenticated artifacts")
        for name, checksum in files.items():
            reject_key_name(name, key)
            recovery.regular_file(folder / name, protected=True)
            if recovery.digest(folder / name) != checksum:
                raise recovery.RecoveryError(f"Update packet checksum failed: {name}")
        verify_manifest(folder, profile)
    if profile == "docker" and not present(folder / "installation_settings.tar.gz"):
        raise recovery.RecoveryError("Docker update packet lacks its installation settings archive")
    recovery.verify_packet_files(folder, key)
    for name, roots in ARCHIVE_ROOTS.items():
        if present(folder / name):
            verify_archive(folder / name, roots, key=key, legacy_media=not present(record_path) and name != "installation_settings.tar.gz")
    if database and present(folder / "installation_settings.tar.gz"):
        recovery.verify_settings_archive(folder / "installation_settings.tar.gz", database["settings"], key=key, full_installation=True)
    # Rollback must refuse an unsafe/missing root target while the app still runs.
    preflight_archives(root, key, profile)
    return record if present(record_path) else None


@recovery.recovery_operation
def seal_update(folder: Path, root: Path, profile: str, paths: list[Path]) -> None:
    key = recovery.packet_key(root, profile, paths)
    with recovery.private_diagnostics("seal-update", packet=folder, key=key, packet_unchanged=False) as logs:
        snapshot = recovery.snapshot_packet(folder, logs / "update_snapshot", key)
        _seal_update_snapshot(snapshot, root, profile, paths, folder)


@recovery.recovery_operation
def _seal_update_snapshot(folder: Path, root: Path, profile: str, paths: list[Path], target: Path) -> None:
    """Write the authenticated completion record last, after every updater artifact."""
    recovery.private_folder(folder)
    if present(folder / RECORD):
        raise recovery.RecoveryError("Update packet is already complete")
    database = recovery._verify_packet_snapshot(folder, root, profile, paths)
    if database["format_version"] != 2:
        raise recovery.RecoveryError("New update packets require an authenticated database packet")
    verify_manifest(folder, profile)
    key = recovery.packet_key(root, profile, paths)
    for name, roots in ARCHIVE_ROOTS.items():
        if present(folder / name):
            verify_archive(folder / name, roots, key=key)
    settings_archive = folder / "installation_settings.tar.gz"
    if present(settings_archive):
        recovery.verify_settings_archive(settings_archive, database["settings"], key=key, full_installation=True)
    elif profile == "docker":
        raise recovery.RecoveryError("Docker update packet lacks its installation settings archive")
    files = {}
    for name in sorted(packet_files(folder, database)):
        reject_key_name(name, key)
        recovery.regular_file(folder / name, protected=True)
        with (folder / name).open("rb") as source:
            reject_key_bytes(source, key)
        files[name] = recovery.digest(folder / name)
    record = dict(format_version=1, profile=profile, files=files)
    record["mac"] = update_mac(record, key)
    partial = target / (RECORD + ".partial")
    owned = False
    try:
        with recovery.private_file(partial, key=key) as destination:
            owned = True
            destination.write(recovery.canonical(record) + b"\n")
            destination.flush()
            os.fsync(destination.fileno())
        recovery.publish_file(partial, target / RECORD, key=key)
    finally:
        if owned:
            partial.unlink(missing_ok=True)
    verify_update(target, root, profile, paths)


@recovery.recovery_operation
def write_manifest(folder: Path, root: Path, profile: str, paths: list[Path], content: bytes) -> None:
    """Check shell-generated metadata in memory before creating its first file."""
    recovery.private_folder(folder)
    key = recovery.packet_key(root, profile, paths)
    KeyScanner(key).check(content)
    partial = folder / (MANIFEST + ".partial")
    owned = False
    try:
        with recovery.private_file(partial, key=key) as output:
            owned = True
            output.write(content)
        recovery.publish_file(partial, folder / MANIFEST, key=key)
    finally:
        if owned:
            partial.unlink(missing_ok=True)


@recovery.recovery_operation
def extract_update(folder: Path, root: Path, profile: str, paths: list[Path], destination: Path, *, legacy=False, restore_roots=False) -> None:
    """Reverify and snapshot before staging or explicitly restoring existing roots."""
    try:
        relative = destination.relative_to(root)
    except ValueError:
        raise recovery.RecoveryError("Extraction staging must be inside this installation's backups/ folder") from None
    if len(relative.parts) < 2 or relative.parts[0] != "backups" or ".." in relative.parts or destination == folder or folder in destination.parents:
        raise recovery.RecoveryError("Extraction staging must be a new folder outside the packet, below backups/")
    descriptor = directory_descriptor(root, relative.parent.as_posix())
    os.close(descriptor)
    if present(destination):
        raise recovery.RecoveryError("Extraction staging folder already exists")
    key = recovery.packet_key(root, profile, paths) if present(root / "keys" / recovery.KEY) else None
    reject_key_name(destination, key)
    with recovery.private_diagnostics("extract-update", packet=folder, key=key) as logs:
        # Capture and authenticate every artifact together; all subsequent reads
        # use this private folder, including metadata and settings validation.
        folder = recovery.snapshot_packet(folder, logs / ("update_snapshot" if folder.name.startswith("update_") else "packet_snapshot"), key,
            record_check=(RECORD, lambda path: authenticated_update_record(path, profile, key)))
        record = _verify_update_snapshot(folder, root, profile, paths, legacy=legacy)
        snapshots = []
        for name, roots in ARCHIVE_ROOTS.items():
            if record and (name in record["files"]) != present(folder / name):
                raise recovery.RecoveryError("Update archive set changed after authentication")
            if not present(folder / name):
                continue
            path = folder / name
            old_media = record is None and name != "installation_settings.tar.gz"
            verify_archive(path, roots, key=key, legacy_media=old_media)
            snapshots.append((path, roots, old_media))
        destination.mkdir(mode=0o700)
        try:
            for path, roots, old_media in snapshots:
                extract_archive(path, destination, roots, key=key, legacy_media=old_media)
        except BaseException:
            shutil.rmtree(destination)
            raise
        if restore_roots:
            restore_staged_roots(root, destination, key, profile)


def main() -> int:
    parser = recovery.RecoveryArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("preflight", "archive", "manifest", "seal", "verify", "extract"))
    parser.add_argument("--root", required=True)
    parser.add_argument("--profile", required=True, choices=("native", "docker"))
    parser.add_argument("--settings", action="append", default=[])
    parser.add_argument("--backup")
    parser.add_argument("--destination")
    parser.add_argument("--legacy", action="store_true")
    parser.add_argument("--print-source-commit", action="store_true", help="verify only: print the authenticated previous commit alone on stdout; progress goes to stderr")
    parser.add_argument("--restore-roots", action="store_true", help="after staging, retain old contents beside staging and restore through existing root links")
    parser.add_argument("--home", action="append", default=[], help="native recovery home to check before shutdown")
    args = parser.parse_args()
    if args.action != "preflight" and not args.backup or args.action == "extract" and not args.destination:
        parser.error("packet actions require --backup; extract also requires --destination")
    if args.legacy and args.action not in ("verify", "extract"):
        parser.error("--legacy applies only to verify/extract")
    if args.restore_roots and args.action != "extract":
        parser.error("--restore-roots applies only to extract")
    if args.print_source_commit and args.action != "verify":
        parser.error("--print-source-commit applies only to verify")
    outcome = recovery.Outcome([{"preflight": "Check archive roots and link-free contents before shutdown",
        "archive": "Create safe installation archives", "manifest": "Check and write update metadata", "seal": "Authenticate the whole update packet",
        "verify": "Verify the whole update packet without changes", "extract": "Reverify and stage bounded archives"}[args.action]])
    try:
        root = Path(args.root).resolve()
        recovery.prime_diagnostic_key(root)
        verify_root_link_policy(root, args.profile)
        paths = recovery.setting_paths(root, args.profile, args.settings)
        folder = Path(args.backup).absolute() if args.backup else None
        if args.action == "preflight":
            if any(path.exists() and path.relative_to(root).parts[0] not in ("keys", "config", "projects") for path in paths):
                raise recovery.RecoveryError("Update recovery settings must be below keys/, config/ or projects/")
            for home in args.home:
                verify_native_home(root, Path(home).absolute())
            outcome.step(preflight_archives, root, recovery.packet_key(root, args.profile, paths), args.profile)
        elif args.action == "archive":
            recovery.private_folder(folder)
            outcome.step(create_archives, root, folder, recovery.packet_key(root, args.profile, paths), args.profile)
        elif args.action == "seal":
            outcome.step(seal_update, folder, root, args.profile, paths)
        elif args.action == "manifest":
            outcome.step(write_manifest, folder, root, args.profile, paths, sys.stdin.buffer.read())
        elif args.action == "verify":
            with redirect_stdout(sys.stderr if args.print_source_commit else sys.stdout):
                record = outcome.step(verify_update, folder, root, args.profile, paths, legacy=args.legacy, return_source_commit=args.print_source_commit)
            if record is None:
                recovery.print_diagnostic("WARNING: legacy update archives and manifest are UNAUTHENTICATED; accepting their origin and contents is the operator's responsibility.", file=sys.stderr)
        else:
            outcome.step(extract_update, folder, root, args.profile, paths, Path(args.destination).absolute(), legacy=args.legacy, restore_roots=args.restore_roots)
        with redirect_stdout(sys.stderr if args.print_source_commit else sys.stdout):
            outcome.finish({"preflight": "Archive roots checked; links below roots refused, signing-key filename excluded.",
                "archive": "Safe archives created; signing key excluded.", "manifest": "Checked update metadata written.", "seal": "Whole-update completion record written last.",
                "verify": "Update packet checked; no files or services changed.", "extract": "Archives staged; original contents retained and roots restored." if args.restore_roots else "Archives staged; live installation files unchanged."}[args.action])
        if args.print_source_commit:
            print(record)
        return 0
    except recovery.RecoveryError as error:
        outcome.fail(str(error))
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError):
        outcome.fail("Update packet or archive sources could not be validated; installation not replaced")
    return 1


if __name__ == "__main__":
    sys.exit(main())
