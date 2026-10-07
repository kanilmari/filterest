# test_docker_frontend_build_inputs.py
# Checks that the image's frontend build stage receives every application file the Vite configuration reads.
# Bridges app/frontend/vite.config.mjs and the frontend-builder stage of app/docker/Dockerfile.
# Exists because the page-recovery assets reached the Vite configuration but not the image build (WL158).
"""The Docker frontend build stage copies every application file the Vite configuration reads."""

from pathlib import Path
import re
import unittest

APP = Path(__file__).resolve().parents[2]


def frontend_builder_copies(dockerfile: str) -> list[str]:
    """Return the source paths of the frontend-builder stage's COPY instructions."""
    in_stage, copies = False, []
    for line in dockerfile.splitlines():
        if line.startswith("FROM "):
            in_stage = line.rstrip().endswith(" AS frontend-builder")
        elif in_stage and line.startswith("COPY ") and "--from=" not in line:
            copies.extend(source.rstrip("/") for source in line.split()[1:-1])
    return copies


class DockerFrontendBuildInputTests(unittest.TestCase):
    def test_every_application_file_the_vite_configuration_reads_is_copied(self) -> None:
        config = (APP / "frontend/vite.config.mjs").read_text(encoding="utf-8")
        read = re.findall(r"readFileSync\(join\(canonicalApplicationRoot, '([^']+)'\)", config)
        self.assertTrue(read, "vite.config.mjs no longer reads application files the way this test expects")
        copies = frontend_builder_copies((APP / "docker/Dockerfile").read_text(encoding="utf-8"))
        for path in read:
            self.assertTrue(
                any(path == copied or path.startswith(copied + "/") for copied in copies),
                f"vite.config.mjs reads {path}, but the frontend-builder stage does not copy it",
            )


if __name__ == "__main__":
    unittest.main()
