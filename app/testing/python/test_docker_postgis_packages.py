# test_docker_postgis_packages.py
# Checks that the database image installs available PostGIS 3 packages and logs their versions.
# Connects the PostgreSQL 16 database Dockerfile to its offline build contract.
# Prevents deleted APT package builds from breaking image rebuilds (J38, #896).

from pathlib import Path
import re
import shlex


APP = Path(__file__).resolve().parents[2]
POSTGIS_PACKAGES = ("postgresql-16-postgis-3", "postgresql-16-postgis-3-scripts")


def test_postgis_packages_are_unpinned_and_log_installed_versions() -> None:
    dockerfile = (APP / "docker/Dockerfile.db").read_text(encoding="utf-8")
    assert not re.search(r"\bpostgresql-16-postgis-3(?:-scripts)?\s*=", dockerfile), (
        "PostGIS package build pins eventually disappear from the APT repository"
    )
    instructions = dockerfile.replace("\\\n", " ").splitlines()
    install_runs = [
        line.strip()[4:] for line in instructions
        if line.strip().startswith("RUN ") and "apt-get install" in line
    ]
    assert len(install_runs) == 1, "Expected the database image's package-install RUN"
    commands = [shlex.split(command) for command in install_runs[0].split("&&")]
    install = next(command for command in commands if command[:2] == ["apt-get", "install"])
    assert set(POSTGIS_PACKAGES).issubset(install), "Keep PostgreSQL 16 / PostGIS 3 packages"
    assert "--no-install-recommends" in install
    query = next(
        (command for command in commands if command[:2] == ["dpkg-query", "-W"]), []
    )
    assert set(POSTGIS_PACKAGES).issubset(query), (
        "Print both installed PostGIS versions in the package-install RUN"
    )
    cleanup = ["rm", "-rf", "/var/lib/apt/lists/*"]
    assert cleanup in commands, "Keep the APT list cleanup in the same RUN"
    assert commands.index(install) < commands.index(query) < commands.index(cleanup)
