"""alpine_package_policy.py
Checks a Dockerfile against the Alpine package policy every Filterest-based image follows.
Bridges Filterest's own Docker contract test and images that compose Filterest.
Exists so no image can again name a package build that Alpine has already deleted.

The policy: the Alpine release branch named by the base images is the only
package version constraint. An Alpine branch index keeps only the newest build
of each package and removes the one it replaces, so an exact (`pkg=1.2.3-r0`)
or fuzzy (`pkg~=1.2`) version in `apk add` eventually names a build that no
longer exists and the image cannot be built. Every stage that names an Alpine
branch must name the same one, because a binary built in one stage links the C
library dynamically and runs in another. The check holds no package versions,
so nothing here needs updating when Alpine publishes a new build.
"""

from __future__ import annotations

import re


_ALPINE_BRANCH = re.compile(r"alpine:?(\d+\.\d+)(?:\.\d+)?(?![\d.])")
_APK_ADD = re.compile(r"\bapk\s+(?:-\S+\s+)*add\b([^&;|]*)")
_UNVERSIONED_PACKAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]*$")
# apk options whose value is a separate word rather than a package name.
_OPTIONS_WITH_VALUE = frozenset({"-t", "--virtual", "-X", "--repository"})


def _instructions(dockerfile: str) -> list[str]:
    """Return the Dockerfile's instructions with line continuations joined."""
    return [line.strip() for line in dockerfile.replace("\\\n", " ").splitlines()]


def alpine_branches(dockerfile: str) -> dict[str, str]:
    """Map each base image that names an Alpine release branch to that branch."""
    branches = {}
    for instruction in _instructions(dockerfile):
        if not instruction.startswith("FROM "):
            continue
        base_image = instruction.split()[1]
        branch = _ALPINE_BRANCH.search(base_image)
        if branch:
            branches[base_image] = branch.group(1)
    return branches


def alpine_packages(dockerfile: str) -> list[str]:
    """Return every package argument of every `apk add`, exactly as written."""
    packages = []
    for instruction in _instructions(dockerfile):
        if not instruction.startswith("RUN "):
            continue
        for match in _APK_ADD.finditer(instruction):
            skip_value = False
            for token in match.group(1).split():
                if skip_value:
                    skip_value = False
                elif token in _OPTIONS_WITH_VALUE:
                    skip_value = True
                elif not token.startswith("-"):
                    packages.append(token)
    return packages


def alpine_package_policy_violations(dockerfile: str) -> list[str]:
    """Return every breach of the policy above; an empty list means compliance.

    A Dockerfile that names no Alpine branch or installs no Alpine package is
    reported too, so a parsing change cannot make the check pass vacuously.
    """
    violations = []
    branches = alpine_branches(dockerfile)
    if not branches:
        violations.append("no base image names an Alpine release branch")
    elif len(set(branches.values())) > 1:
        violations.append(f"base images name different Alpine release branches: {branches}")
    packages = alpine_packages(dockerfile)
    if not packages:
        violations.append("no `apk add` installs a package")
    for package in packages:
        if not _UNVERSIONED_PACKAGE.match(package):
            violations.append(
                f"`apk add` package {package!r} names a version; the Alpine "
                "release branch is the only version constraint"
            )
    return violations
