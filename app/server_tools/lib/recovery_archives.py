"""recovery_archives.py: bounded installation recovery archives and root paths.

Connects update preflight, archive creation and rollback member validation.
Resolves operator-owned root links once; refuses links below them and unsafe bytes.
"""
from __future__ import annotations

import os
import gzip
from contextlib import ExitStack, contextmanager
from pathlib import Path, PurePosixPath
import stat
import tarfile

if __package__:
    from .database_recovery_packet_io import (RecoveryError, regular_file, private_file,
        publish_file, recovery_operation, stream_digest)
    from .recovery_key_safety import KEY_NAME, KeySafeReader, reject_key_bytes, reject_key_name
else:
    from database_recovery_packet_io import (RecoveryError, regular_file, private_file,
        publish_file, recovery_operation, stream_digest)
    from recovery_key_safety import KEY_NAME, KeySafeReader, reject_key_bytes, reject_key_name

ARCHIVE_ROOTS = {
    "installation_settings.tar.gz": ("keys", "config", "projects"),
    "storage.tar.gz": ("data/storage", "data/storage_deleted"),
    "bootstrap.tar.gz": ("data/bootstrap",),
}


@recovery_operation
def verify_root_link_policy(root: Path, profile: str = "native") -> None:
    """Match lifecycle refusals before any settings read, archive or shutdown.

    Bootstrap is never relocatable. Docker's runner requires real installation
    directories at start, so accepting a root link could leave an update stopped.
    """
    bootstrap = root / "data/bootstrap"
    docker_reason = "; Docker installations keep these as real directories; the runner refuses links at start" if profile == "docker" else ""
    if bootstrap.is_symlink():
        raise RecoveryError(f"{bootstrap}: bootstrap state directory must not be a symbolic link{docker_reason}")
    if profile == "docker":
        for names in ARCHIVE_ROOTS.values():
            for name in names:
                logical = root / name
                if logical.is_symlink():
                    raise RecoveryError(f"{logical}: Docker installations keep these as real directories; the runner refuses links at start")


@recovery_operation
def directory_descriptor(root: Path, relative: str = "", *, create=False, missing_ok=False) -> int | None:
    """Open every directory component without following a symbolic link.

    With missing_ok, an absent component below the root gives None; a link still fails (ELOOP/ENOTDIR, not ENOENT).
    """
    if PurePosixPath(relative).is_absolute():
        raise RecoveryError(f"{relative}: absolute descendant path is refused")
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in PurePosixPath(relative).parts:
            if name == "..":
                raise RecoveryError(f"{relative}: parent traversal is refused")
            if create:
                try:
                    os.mkdir(name, mode=0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
            try:
                next_descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            except FileNotFoundError:
                if not missing_ok:
                    raise
                os.close(descriptor)
                return None
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


@recovery_operation
def resolve_archive_root(root: Path, relative: str) -> Path:
    """Only the logical archive root may link to another operator-owned directory."""
    if relative not in {name for names in ARCHIVE_ROOTS.values() for name in names}:
        raise RecoveryError(f"{relative}: unsupported archive root")
    parent = directory_descriptor(root, str(PurePosixPath(relative).parent))
    os.close(parent)
    logical = root / relative
    if relative == "data/bootstrap":
        if logical.is_symlink():
            raise RecoveryError(f"{logical}: bootstrap state directory must not be a symbolic link")
        if logical.exists() and not logical.is_dir():
            raise RecoveryError(f"{logical}: bootstrap state path is not a directory")
    try:
        resolved = logical.resolve(strict=True)
        descriptor = directory_descriptor(resolved)
    except OSError as error:
        raise RecoveryError(f"{logical}: root target {error.filename}: {error.strerror}") from None
    except (RecoveryError, RuntimeError) as error:
        raise RecoveryError(f"{logical}: root target cannot be opened: {error}") from None
    try:
        if os.fstat(descriptor).st_uid != os.getuid():
            raise RecoveryError(f"{logical}: root target {resolved} must be owned by the operator")
    finally:
        os.close(descriptor)
    if relative.startswith("data/"):
        keys = (root / "keys").resolve()
        if resolved == keys or keys in resolved.parents:
            raise RecoveryError(f"{logical}: root target {resolved} resolves into keys/")
    return resolved


@recovery_operation
def logical_settings_path(root: Path, path: Path) -> Path:
    """Map resolved native settings back to a portable logical settings root.

    Arbitrary external native homes remain unsupported. A canonical root link
    permits relocation, never a link at a deeper settings path.
    """
    try:
        relative = path.relative_to(root)
    except ValueError:
        relative = None
        for name in ARCHIVE_ROOTS["installation_settings.tar.gz"]:
            if not (root / name).exists() and not (root / name).is_symlink():
                continue
            resolved = resolve_archive_root(root, name)
            if path.is_relative_to(resolved):
                relative = Path(name) / path.relative_to(resolved)
                break
        if relative is None:
            raise RecoveryError(f"{path}: Protected settings must be inside the installation folder or a relocated settings root for portable recovery")
    if ".." in relative.parts or not relative.parts:
        raise RecoveryError(f"{path}: unsafe protected settings path")
    if relative.parts[0] in ARCHIVE_ROOTS["installation_settings.tar.gz"]:
        logical_root = root / relative.parts[0]
        if not logical_root.exists() and not logical_root.is_symlink():
            return root / relative
        resolved = resolve_archive_root(root, relative.parts[0])
        below = Path(*relative.parts[1:])
        descriptor = directory_descriptor(resolved, str(below.parent), missing_ok=True)
    else:
        descriptor = directory_descriptor(root, str(relative.parent), missing_ok=True)
    if descriptor is None:
        # An absent settings folder is an absent optional settings file, e.g. keys/filterest_runtime/.
        return root / relative
    try:
        try:
            metadata = os.stat(relative.name, dir_fd=descriptor, follow_symlinks=False)
        except FileNotFoundError:
            return root / relative
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise RecoveryError(f"{path}: Protected settings must be regular files without links")
    finally:
        os.close(descriptor)
    return root / relative


@recovery_operation
def verify_native_home(root: Path, home: Path) -> None:
    """Allow absent standard homes, but map external homes only through root links."""
    names = ARCHIVE_ROOTS["installation_settings.tar.gz"]
    if home.is_relative_to(root):
        relative = home.relative_to(root)
        if relative.parts and relative.parts[0] in names and ".." not in relative.parts:
            return
    for name in names:
        if (root / name).exists() or (root / name).is_symlink():
            if home.is_relative_to(resolve_archive_root(root, name)):
                return
    raise RecoveryError(f"{home}: Recovery homes must be inside the installation folder's logical keys/, config/ or projects/ roots")


@recovery_operation
def visit_tree(root: Path, relative: str, key: bytes, archive=None, *, resolved=None) -> None:
    """Preflight and archive through the same open-directory, regular-file boundary.

    Below each root, all symlinks (also in-tree links), hard-linked files and
    special files are refused. Settings omit the key filename; media refuses it.
    """
    def visit(descriptor, name):
        reject_key_name(name, key)
        metadata = os.fstat(descriptor)
        if archive is not None:
            member = tarfile.TarInfo(name)
            member.type, member.mode, member.mtime = tarfile.DIRTYPE, 0o700, metadata.st_mtime
            archive.addfile(member)
        for entry in sorted(os.scandir(descriptor), key=lambda entry: entry.name):
            path = name + "/" + entry.name
            reject_key_name(path, key)
            metadata = entry.stat(follow_symlinks=False)
            if stat.S_ISLNK(metadata.st_mode):
                raise RecoveryError(f"Update archive preflight refuses symbolic links: {path}")
            if not (stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode)):
                raise RecoveryError(f"Update archive preflight requires regular files and directories: {path}")
            if stat.S_ISREG(metadata.st_mode) and metadata.st_nlink != 1:
                raise RecoveryError(f"Update archive preflight refuses hard-linked files: {path}")
            if entry.name == KEY_NAME:
                if relative.startswith("data/"):
                    raise RecoveryError(f"{path}: media/bootstrap root contains the recovery authentication key file")
                continue
            if stat.S_ISDIR(metadata.st_mode):
                child = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                try:
                    visit(child, path)
                finally:
                    os.close(child)
            else:
                child = os.open(entry.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
                with os.fdopen(child, "rb") as content:
                    metadata = os.fstat(content.fileno())
                    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                        raise RecoveryError(f"{path}: Archive source changed to an unsafe file")
                    reject_key_bytes(content, key, path)
                    if archive is not None:
                        content.seek(0)
                        member = tarfile.TarInfo(path)
                        member.size, member.mode, member.mtime = metadata.st_size, metadata.st_mode & 0o777, metadata.st_mtime
                        archive.addfile(member, KeySafeReader(content, key, path))
    descriptor = directory_descriptor(resolved if resolved is not None else resolve_archive_root(root, relative))
    try:
        if os.fstat(descriptor).st_uid != os.getuid():
            raise RecoveryError(f"{root / relative}: root target must be owned by the operator")
        visit(descriptor, relative)
    finally:
        os.close(descriptor)


@recovery_operation
def archive_sources(root: Path) -> dict[str, list[str]]:
    result = {}
    for name, roots in ARCHIVE_ROOTS.items():
        result[name] = [path for path in roots if (root / path).exists() or (root / path).is_symlink()]
    return result


@contextmanager
def settings_source(root: Path, path: Path, key):
    """Open optional protected settings through pinned, link-free descriptors."""
    path = logical_settings_path(root, path)
    relative = path.relative_to(root)
    reject_key_name(relative, key)
    if KEY_NAME in relative.parts:
        raise RecoveryError("The authentication key must never be archived with protected settings")
    if not path.exists() and not path.is_symlink():
        yield relative.as_posix(), None
        return
    if relative.parts[0] in ARCHIVE_ROOTS["installation_settings.tar.gz"]:
        descriptor = directory_descriptor(resolve_archive_root(root, relative.parts[0]), str(Path(*relative.parts[1:]).parent))
    else:
        descriptor = directory_descriptor(root, str(relative.parent))
    try:
        try:
            child = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
        except FileNotFoundError:
            yield relative.as_posix(), None
        else:
            with os.fdopen(child, "rb") as source:
                metadata = os.fstat(source.fileno())
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                    raise RecoveryError(f"{path}: Protected settings must be regular files without hard links")
                if metadata.st_size == 0 or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
                    raise RecoveryError(f"{path}: Protected settings must be nonempty owner-only files owned by the operator")
                yield relative.as_posix(), source
    finally:
        os.close(descriptor)


@recovery_operation
def verify_settings_sources(root: Path, paths: list[Path], key: bytes) -> None:
    for path in paths:
        with settings_source(root, path, key) as (name, source):
            if source is not None:
                reject_key_bytes(source, key, name)


@recovery_operation
def create_settings_archive(root: Path, paths: list[Path], destination: Path, key) -> dict:
    """Record hashes of the scanned bytes actually copied, never a prior read."""
    settings = {}
    with private_file(destination, key=key) as output, tarfile.open(fileobj=output, mode="w:gz") as archive:
        for path in paths:
            with settings_source(root, path, key) as (name, source):
                if name in settings:
                    continue
                settings[name] = None
                if source is not None:
                    metadata = os.fstat(source.fileno())
                    member = tarfile.TarInfo(name)
                    member.size, member.mode, member.mtime = metadata.st_size, 0o600, metadata.st_mtime
                    reader = KeySafeReader(source, key)
                    archive.addfile(member, reader)
                    settings[name] = reader.checksum.hexdigest()
    if not any(settings.values()):
        raise RecoveryError("The installation's protected settings are missing")
    return settings


@recovery_operation
def preflight_archives(root: Path, key: bytes, profile: str = "native") -> dict[str, Path]:
    verify_root_link_policy(root, profile)
    resolved = {}
    for paths in archive_sources(root).values():
        for path in paths:
            target = resolve_archive_root(root, path)
            for other, existing in resolved.items():
                if target.is_relative_to(existing) or existing.is_relative_to(target):
                    raise RecoveryError(f"{root / path}: root target {target} overlaps archive root {root / other}")
            resolved[path] = target
            visit_tree(root, path, key, resolved=resolved[path])
    return resolved


@recovery_operation
def create_archives(root: Path, folder: Path, key: bytes, profile: str = "native") -> None:
    """Publish only fully scanned archives, never an unsafe partial archive."""
    resolved = preflight_archives(root, key, profile)
    for name, roots in ARCHIVE_ROOTS.items():
        paths = [path for path in roots if path in resolved]
        if not paths:
            continue
        partial = folder / (name + ".partial")
        owned = False
        try:
            with private_file(partial, key=key) as destination:
                owned = True
                with tarfile.open(fileobj=destination, mode="w:gz") as archive:
                    for path in paths:
                        visit_tree(root, path, key, archive, resolved=resolved[path])
                destination.flush()
                os.fsync(destination.fileno())
            # Exclusive publication also preserves packets an operator already made.
            verify_archive(partial, roots, key=key)
            publish_file(partial, folder / name, key=key)
        finally:
            if owned:
                partial.unlink(missing_ok=True)


def safe_members(source, roots: tuple[str, ...], *, key=None, legacy_media=False, root_directories=True) -> list[tuple[tarfile.TarInfo, str]]:
    """Validate every member before extraction; normalize old media roots only explicitly."""
    members, names = [], {}
    for member in source.getmembers():
        reject_key_name(member.name, key)
        for field, value in member.pax_headers.items():
            reject_key_name(field, key)
            reject_key_name(value, key)
        name = member.name.rstrip("/")
        parts = name.split("/")
        if not name or name.startswith("/") or any(part in ("", ".", "..") for part in parts) or "\\" in name or any(ord(c) < 32 for c in name):
            raise RecoveryError(f"{member.name!r}: Archive contains an unsafe member path")
        if legacy_media and parts[0] in ("storage", "storage_deleted", "bootstrap"):
            name = "data/" + name
        if KEY_NAME in parts:
            raise RecoveryError(f"{name}: Archive contains the recovery authentication key")
        if not any(name == root or name.startswith(root + "/") for root in roots):
            raise RecoveryError(f"{name}: Archive member lies outside its intended roots")
        if not (member.isfile() or member.isdir()) or member.islnk() or member.issym():
            raise RecoveryError(f"{name}: Archive permits regular files and directories only; links and special files are refused")
        if name in names or root_directories and name in roots and not member.isdir():
            raise RecoveryError(f"{name}: Archive contains duplicate paths or a non-directory root")
        names[name] = member
        members.append((member, name))
    for name in names:
        if any(parent.as_posix() in names and not names[parent.as_posix()].isdir() for parent in PurePosixPath(name).parents):
            raise RecoveryError(f"{name}: Archive contains a file used as a parent directory")
    return members


@recovery_operation
def verify_archive(path: Path, roots: tuple[str, ...], *, key=None, legacy_media=False) -> None:
    regular_file(path, protected=True)
    # Include tar headers/global PAX metadata, even bytes tarfile normalizes away.
    with gzip.open(path, "rb") as content:
        reject_key_bytes(content, key)
    with tarfile.open(path, "r:gz") as source:
        members = safe_members(source, roots, key=key, legacy_media=legacy_media)
        for member, name in members:
            if member.isfile():
                with source.extractfile(member) as content:
                    if key is not None:
                        reject_key_bytes(content, key, name)
                    else:
                        # Even old packets must be fully readable before any write.
                        while content.read(1024 * 1024):
                            pass


@recovery_operation
def extract_archive(path: Path, destination: Path, roots: tuple[str, ...], *, key=None, legacy_media=False) -> None:
    """Extract via pinned root descriptors; only the root itself may be a link."""
    reject_key_name(destination, key)
    regular_file(path, protected=True)
    with tarfile.open(path, "r:gz") as source:
        members = safe_members(source, roots, key=key, legacy_media=legacy_media)
        with ExitStack() as stack:
            descriptors = {}
            for name in roots:
                if not any(member_name == name or member_name.startswith(name + "/") for _, member_name in members):
                    continue
                logical = destination / name
                if not logical.exists() and not logical.is_symlink():
                    parent = directory_descriptor(destination, str(PurePosixPath(name).parent), create=True)
                    try:
                        os.mkdir(logical.name, mode=0o700, dir_fd=parent)
                    finally:
                        os.close(parent)
                descriptors[name] = directory_descriptor(resolve_archive_root(destination, name))
                stack.callback(os.close, descriptors[name])
                if os.fstat(descriptors[name]).st_uid != os.getuid():
                    raise RecoveryError(f"{logical}: root target must be owned by the operator")
            for member, name in members:
                archive_root = next(root for root in roots if name == root or name.startswith(root + "/"))
                below = PurePosixPath(name).relative_to(archive_root)
                if not below.parts:
                    continue
                parent = descendant_descriptor(descriptors[archive_root], str(below.parent), create=True)
                try:
                    if member.isdir():
                        child = descendant_descriptor(parent, below.name, create=True)
                        os.close(child)
                    else:
                        child = os.open(below.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                        0o600, dir_fd=parent)
                        with os.fdopen(child, "wb") as output, source.extractfile(member) as content:
                            reader = KeySafeReader(content, key)
                            for chunk in iter(lambda: reader.read(1024 * 1024), b""):
                                output.write(chunk)
                            os.fchmod(output.fileno(), 0o600 | (member.mode & 0o100))
                except OSError as error:
                    raise RecoveryError(f"{destination / name}: {error.strerror}") from None
                finally:
                    os.close(parent)


def descendant_descriptor(descriptor: int, relative: str, *, create=False) -> int:
    """Open descendants of a pinned root without following any links."""
    if PurePosixPath(relative).is_absolute():
        raise RecoveryError(f"{relative}: absolute descendant path is refused")
    child = os.dup(descriptor)
    try:
        for name in PurePosixPath(relative).parts:
            if name == "..":
                raise RecoveryError(f"{relative}: parent traversal is refused")
            if create:
                try:
                    os.mkdir(name, mode=0o700, dir_fd=child)
                except FileExistsError:
                    pass
            next_child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=child)
            os.close(child)
            child = next_child
        return child
    except OSError as error:
        os.close(child)
        raise RecoveryError(f"{relative}: {error.strerror}") from None
    except BaseException:
        os.close(child)
        raise


@recovery_operation
def copy_tree(logical: str, source: int, destination: int, *, key=None, omit_key=False) -> None:
    """Copy retained or staged regular files through descriptors across filesystems."""
    for entry in sorted(os.scandir(source), key=lambda entry: entry.name):
        name = logical + "/" + entry.name
        reject_key_name(name, key)
        metadata = entry.stat(follow_symlinks=False)
        if entry.name == KEY_NAME:
            if omit_key and stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1:
                continue
            raise RecoveryError("Staged/retained trees must not contain the recovery authentication key file")
        if stat.S_ISDIR(metadata.st_mode):
            source_child = descendant_descriptor(source, entry.name)
            try:
                destination_child = descendant_descriptor(destination, entry.name, create=True)
                try:
                    copy_tree(name, source_child, destination_child, key=key, omit_key=omit_key)
                finally:
                    os.close(destination_child)
            finally:
                os.close(source_child)
        elif stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1:
            child = os.open(entry.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=source)
            with os.fdopen(child, "rb") as content:
                metadata = os.fstat(content.fileno())
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                    raise RecoveryError(f"{name}: source changed to an unsafe file")
                target = os.open(entry.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=destination)
                with os.fdopen(target, "wb") as output:
                    reader = KeySafeReader(content, key)
                    try:
                        for chunk in iter(lambda: reader.read(1024 * 1024), b""):
                            output.write(chunk)
                    except BaseException:
                        os.unlink(entry.name, dir_fd=destination)
                        raise
                    os.fchmod(output.fileno(), 0o600 | (metadata.st_mode & 0o100))
        else:
            raise RecoveryError(f"{name}: symbolic links, hard links and special files are refused")


@recovery_operation
def clear_tree(logical: str, descriptor: int, *, keep_key=False) -> None:
    """Remove retained entries without following a link; preserve the live signing key."""
    for entry in sorted(os.scandir(descriptor), key=lambda entry: entry.name):
        name = logical + "/" + entry.name
        metadata = entry.stat(follow_symlinks=False)
        if stat.S_ISDIR(metadata.st_mode):
            child = descendant_descriptor(descriptor, entry.name)
            try:
                clear_tree(name, child)
            finally:
                os.close(child)
            os.rmdir(entry.name, dir_fd=descriptor)
        elif stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1:
            if not (keep_key and entry.name == KEY_NAME):
                os.unlink(entry.name, dir_fd=descriptor)
        else:
            raise RecoveryError(f"{name}: symbolic links, hard links and special files are refused")


@recovery_operation
def restore_staged_roots(root: Path, staging: Path, key: bytes, profile: str = "native") -> None:
    """Retain replaced contents, then restore through the same pinned live root.

    Root links and the separately protected signing key stay in place. No live
    contents are removed until every original root has been retained successfully.
    """
    reject_key_name(root, key)
    reject_key_name(staging, key)
    resolved = preflight_archives(root, key, profile)
    staged = preflight_archives(staging, key, profile)
    if any(path.name == KEY_NAME for path in staging.rglob(KEY_NAME)):
        raise RecoveryError("Staging must not contain the recovery authentication key file")
    with ExitStack() as stack:
        retention = directory_descriptor(staging.parent)
        stack.callback(os.close, retention)
        live_descriptors, staged_descriptors = {}, {}
        for name in sorted(set(resolved) | set(staged)):
            if name not in resolved:
                parent = directory_descriptor(root, str(PurePosixPath(name).parent), create=True)
                try:
                    os.mkdir(PurePosixPath(name).name, mode=0o700, dir_fd=parent)
                finally:
                    os.close(parent)
                resolved[name] = resolve_archive_root(root, name)
            target = resolved[name]
            if target == staging.parent or target in staging.parents or staging.parent in target.parents:
                raise RecoveryError(f"{root / name}: root target overlaps the rollback staging/retention folder")
            live = directory_descriptor(target)
            stack.callback(os.close, live)
            if os.fstat(live).st_uid != os.getuid():
                raise RecoveryError(f"{root / name}: root target must be owned by the operator")
            live_descriptors[name] = live
            if (staging.parent / name).exists() or (staging.parent / name).is_symlink():
                raise RecoveryError(f"{staging.parent / name}: retention root already exists")
            retained = descendant_descriptor(retention, name, create=True)
            try:
                copy_tree(str(root / name), live, retained, key=key, omit_key=True)
            finally:
                os.close(retained)
            if name in staged:
                staged_descriptors[name] = directory_descriptor(staged[name])
                stack.callback(os.close, staged_descriptors[name])
        for name, live in live_descriptors.items():
            clear_tree(str(root / name), live, keep_key=name == "keys")
            if name in staged_descriptors:
                copy_tree(str(staging / name), staged_descriptors[name], live, key=key)


@recovery_operation
def verify_settings_archive(archive: Path, settings: dict[str, str | None], *, key=None, full_installation=False) -> None:
    regular_file(archive, protected=True)
    with gzip.open(archive, "rb") as content:
        reject_key_bytes(content, key)
    with tarfile.open(archive, "r:gz") as source:
        roots = ("keys", "config", "projects") if full_installation else tuple(settings)
        for name in settings:
            reject_key_name(name, key)
        entries = [member for member, _ in safe_members(source, roots, key=key, root_directories=full_installation)]
        for member in entries:
            if member.isfile():
                with source.extractfile(member) as content:
                    reject_key_bytes(content, key, member.name)
        if not full_installation and any(member.name not in settings or not member.isfile() for member in entries):
            raise RecoveryError("Database settings archive contains unexpected members")
        members = {member.name: member for member in entries}
        if len(members) != len(entries):
            raise RecoveryError("Settings archive contains duplicate paths")
        if any(Path(member.name).name == KEY_NAME for member in entries):
            raise RecoveryError("Settings archive contains the recovery authentication key; create a new safe packet")
        for name, checksum in settings.items():
            member = members.get(name)
            if checksum is None:
                if member is not None:
                    raise RecoveryError("Settings archive contains an unexpected effective settings file")
            elif member is None or not member.isfile():
                raise RecoveryError("Settings archive lacks the backed-up protected settings")
            else:
                with source.extractfile(member) as content:
                    if stream_digest(KeySafeReader(content, key)) != checksum:
                        raise RecoveryError("Settings changed while the backup was being created")
