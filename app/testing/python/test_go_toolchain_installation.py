"""test_go_toolchain_installation.py
Verify exact Go release selection and installation refusal before untrusted extraction.
Connect the canonical installer to isolated metadata, download and toolchain fixtures.
Keep missing PATH toolchains recoverable without weakening checksum verification.
"""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2]
INSTALLER = SOURCE / "server_tools/install_filterest.sh"
VERSION = "1.26.5"
ARCHIVE = f"go{VERSION}.linux-amd64.tar.gz"


class GoToolchainInstallationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in ("source", "bin", "scratch", "tools", "local-bin"):
            (self.root / name).mkdir()
        (self.root / "source/go.mod").write_text(f"module fixture\n\ngo {VERSION}\n")
        self.archive = self.root / "download.tar.gz"
        with tarfile.open(self.archive, "w:gz") as archive:
            content = b"#!/bin/sh\necho fixture\n"
            member = tarfile.TarInfo("go/bin/go")
            member.size = len(content)
            member.mode = 0o755
            archive.addfile(member, io.BytesIO(content))
        self.metadata = [{"version": "go" + VERSION, "stable": True, "files": [{
            "filename": ARCHIVE, "version": "go" + VERSION, "os": "linux",
            "arch": "amd64", "kind": "archive",
            "sha256": hashlib.sha256(self.archive.read_bytes()).hexdigest(),
        }]}]
        # The unavailable Go command exercises the same branch as a stripped PATH.
        self.write_command("go", "#!/bin/sh\nexit 127\n")
        self.write_command("curl", r"""#!/usr/bin/python3
import os, pathlib, shutil, sys
root = pathlib.Path(os.environ['TEST_GO_ROOT'])
url = sys.argv[-1]
with (root / 'requests').open('a') as log:
    log.write(url + '\n')
if os.environ.get('TEST_CURL_FAILURE') == '1':
    raise SystemExit(22)
target = pathlib.Path(sys.argv[sys.argv.index('-o') + 1])
if url == 'https://go.dev/dl/?mode=json&include=all':
    shutil.copyfile(root / 'metadata.json', target)
elif url.endswith('.sha256'):
    target.write_text('<html>Not a checksum</html>')
else:
    shutil.copyfile(root / 'download.tar.gz', target)
""")
        # If verification fails, neither extraction nor replacement may happen.
        self.write_command("tar", "#!/bin/sh\necho extracted >> \"$TEST_GO_ROOT/events\"\nexec /usr/bin/tar \"$@\"\n")
        self.target = self.root / ("tools/go-" + VERSION)
        self.target.mkdir()
        (self.target / "existing").write_text("preserve until verified")

    def write_command(self, name, content):
        path = self.root / "bin" / name
        path.write_text(content)
        path.chmod(0o755)

    def install(self, metadata=None, extra_environment=None):
        (self.root / "metadata.json").write_text(
            metadata if isinstance(metadata, str) else json.dumps(self.metadata if metadata is None else metadata)
        )
        program = r'''set -euo pipefail
export FILTEREST_INSTALLER_LIBRARY_ONLY=1
source "$1"
SOURCE_ROOT="$2/source"
LOCAL_TOOLCHAIN_ROOT="$2/tools"
LOCAL_BIN_DIR="$2/local-bin"
architecture_name() { printf amd64; }
install_go_toolchain_if_needed
'''
        return subprocess.run(
            ["bash", "-c", program, "test", str(INSTALLER), str(self.root)],
            env={**os.environ, "PATH": str(self.root / "bin") + ":/usr/bin:/bin",
                 "TMPDIR": str(self.root / "scratch"), "TEST_GO_ROOT": str(self.root),
                 **(extra_environment or {})}, text=True, capture_output=True,
        )

    def assert_rejected(self, result):
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.target / "existing").read_text(), "preserve until verified")
        self.assertFalse((self.root / "events").exists(), "unverified archive was extracted")
        self.assertFalse((self.root / "local-bin/go").exists())
        self.assertEqual(list((self.root / "scratch").iterdir()), [])

    def test_missing_go_installs_exact_verified_archive(self):
        # Unrelated future releases must not change the module-selected version.
        metadata = [{"version": "go9.9.9", "stable": True, "files": []}, *self.metadata]
        result = self.install(metadata)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.target / "bin/go").is_file())
        self.assertEqual((self.root / "local-bin/go").resolve(), self.target / "bin/go")
        self.assertEqual((self.root / "requests").read_text().splitlines(), [
            "https://go.dev/dl/?mode=json&include=all", "https://go.dev/dl/" + ARCHIVE,
        ])
        self.assertEqual(list((self.root / "scratch").iterdir()), [])

    def test_matching_go_needs_no_download(self):
        self.write_command("go", f"#!/bin/sh\necho go version go{VERSION} linux/amd64\n")
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / "requests").exists())
        self.assertTrue((self.target / "existing").exists())

    def test_invalid_metadata_never_downloads_or_extracts_archive(self):
        cases = {"html": "<html>not JSON</html>", "wrong root": {}, "missing version": []}
        for label, change in [
            ("missing checksum", {"sha256": None}), ("invalid checksum", {"sha256": "z" * 64}),
            ("wrong OS", {"os": "windows"}), ("wrong architecture", {"arch": "arm64"}),
            ("wrong archive version", {"version": "go9.9.9"}), ("wrong kind", {"kind": "installer"}),
            ("missing archive", {"filename": "another-file.tar.gz"}),
        ]:
            metadata = copy.deepcopy(self.metadata)
            metadata[0]["files"][0].update(change)
            cases[label] = metadata
        cases["duplicate release"] = self.metadata + self.metadata
        duplicate = copy.deepcopy(self.metadata)
        duplicate[0]["files"] *= 2
        cases["duplicate archive"] = duplicate
        unstable = copy.deepcopy(self.metadata)
        unstable[0]["stable"] = False
        cases["unstable version"] = unstable
        for label, metadata in cases.items():
            with self.subTest(label=label):
                (self.root / "requests").unlink(missing_ok=True)
                self.assert_rejected(self.install(metadata))
                self.assertEqual((self.root / "requests").read_text().splitlines(), [
                    "https://go.dev/dl/?mode=json&include=all",
                ])

    def test_wrong_download_checksum_preserves_existing_toolchain(self):
        self.archive.write_bytes(b"modified archive bytes")
        self.assert_rejected(self.install())

    def test_failed_metadata_download_preserves_existing_toolchain(self):
        self.assert_rejected(self.install(extra_environment={"TEST_CURL_FAILURE": "1"}))


if __name__ == "__main__":
    unittest.main()
