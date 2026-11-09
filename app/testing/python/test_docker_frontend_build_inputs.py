# test_docker_frontend_build_inputs.py
# Checks the Docker stages' frontend and embedded Go identity build inputs.
# Connects Vite and the compiled application to their Dockerfile COPY lists.
# Exists because build inputs reached the sources but not the image build (WL158, #1007).
"""The Docker build stages copy every application file their builds read."""

from pathlib import Path
import re
import unittest
from unittest.mock import call, patch

APP = Path(__file__).resolve().parents[2]


def load_repository_details_source() -> str:
    """Preserve CR whitespace: Go ends //go:embed comments only at LF."""
    return (APP / "server_tools/repository_details.go").read_bytes().decode("utf-8")


def load_dockerfile() -> str:
    """Preserve CR whitespace: Dockerfile physical lines end only at LF."""
    return (APP / "docker/Dockerfile").read_bytes().decode("utf-8")


def builder_copies(dockerfile: str, stage: str) -> list[str]:
    """Validate the listed Dockerfile subset before counting context COPY paths."""
    # Supported subset (derived from docker/Dockerfile; refuse everything else):
    # - LF physical lines, with one optional trailing CR; blank / # comment lines.
    # - No parser directives, heredocs, or non-ASCII/control syntax (TAB/CR allowed).
    # - Uppercase keywords at column 0, exactly one space before the arguments.
    # - FROM image[ AS unique-lowercase-name], literal image, single physical line.
    # - COPY: single physical line, unquoted literal path tokens (VERSION_* allowed),
    #   optional first --from=<literal-name>; no other flags, escapes or variables.
    #   Path arguments use SPACE/TAB/CR separators; no JSON form or '..' segments.
    # - RUN, ENV, LABEL, HEALTHCHECK: opaque text with single backslash continuations;
    #   continued payload cannot start with FROM/COPY, even across blanks/comments.
    # - WORKDIR, ARG, USER, EXPOSE, ENTRYPOINT, CMD: opaque, single-line arguments.
    in_stage, copies = False, []
    aliases = set()
    continued_from = None
    continuable = {"RUN", "ENV", "LABEL", "HEALTHCHECK"}
    single_line = {"WORKDIR", "ARG", "USER", "EXPOSE", "ENTRYPOINT", "CMD"}

    def refuse(number: int, reason: str) -> None:
        raise ValueError(f"docker/Dockerfile:{number}: unsupported Dockerfile syntax: {reason}")

    for number, physical in enumerate(dockerfile.split("\n"), 1):
        line = physical.removesuffix("\r")
        stripped = line.lstrip(" \t\r")
        if stripped.startswith("#"):
            if re.match(r"#\s*[A-Za-z][A-Za-z0-9_-]*\s*=", stripped):
                refuse(number, f"parser directive {stripped!r}")
            continue
        if not stripped:
            continue
        if any((ord(char) < 32 and char not in "\t\r") or ord(char) > 126 for char in line):
            refuse(number, f"non-ASCII/control syntax in {line!r}")
        if "<<" in line:
            refuse(number, f"heredoc marker in {line!r}")
        first = stripped.split(maxsplit=1)[0].upper()
        continues = line.rstrip(" \t\r").endswith("\\")
        if first in {"FROM", "COPY"}:
            if continued_from is not None:
                refuse(number, f"{first} reached through continuation from line {continued_from}")
            if continues:
                refuse(number, f"continuation on {first}")
        if continues and (not line.endswith("\\") or line.endswith("\\\\")):
            refuse(number, "only a single backslash at physical end may continue an instruction")
        if continued_from is not None:
            if not continues:
                continued_from = None
            continue
        instruction = re.fullmatch(r"([A-Z]+) ([^ \t\r].*)", line)
        if instruction is None:
            refuse(number, f"noncanonical instruction {line!r}")
        keyword, arguments = instruction.groups()
        if keyword == "FROM":
            header = re.fullmatch(r"[a-z0-9][a-z0-9:./-]*(?: AS ([a-z0-9][a-z0-9_.-]*))?", arguments)
            if header is None:
                refuse(number, f"FROM requires literal image[ AS lowercase-name]: {arguments!r}")
            alias = header[1]
            if alias is not None:
                if alias in aliases:
                    refuse(number, f"duplicate FROM stage {alias!r}")
                aliases.add(alias)
            in_stage = alias == stage
        elif keyword == "COPY":
            paths = arguments.split()
            from_stage = None
            if paths[0].startswith("--from="):
                from_stage = paths.pop(0)[len("--from="):]
                if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]*", from_stage):
                    refuse(number, f"COPY --from requires a literal name: {from_stage!r}")
            if any(path.startswith("--") for path in paths):
                refuse(number, f"COPY flag other than first --from=: {arguments!r}")
            if len(paths) < 2:
                refuse(number, "COPY needs source and destination paths")
            if any((not re.fullmatch(r"[A-Za-z0-9_./][A-Za-z0-9_./-]*", path) and path != "VERSION_*")
                   or ".." in path.split("/") for path in paths):
                refuse(number, f"COPY requires unquoted literal paths, no JSON/escapes/variables: {arguments!r}")
            if in_stage and from_stage is None:
                copies.extend(source.rstrip("/") for source in paths[:-1])
        elif keyword not in continuable | single_line:
            refuse(number, f"unlisted instruction {keyword!r}")
        elif continues:
            if keyword not in continuable:
                refuse(number, f"continuation on {keyword}")
            continued_from = number
    if continued_from is not None:
        refuse(continued_from, "unfinished continuation at end of file")
    return copies


def embed_patterns(source: str, filename: str) -> list[str]:
    """Read every directive's exact paths; reject syntax needing broader resolution."""
    patterns = []
    for number, line in enumerate(source.split("\n"), 1):
        directive = re.match(r"\s*//go:embed(?=\s|$)", line)
        if directive is None:
            continue
        remaining = line[directive.end():].strip()

        def unsupported(pattern: str) -> ValueError:
            return ValueError(f"{filename}:{number}: unsupported embed pattern {pattern!r}")

        if not remaining:
            raise unsupported("<empty directive>")
        while remaining:
            if remaining[0] in ('"', '`'):
                quote = remaining[0]
                end = remaining.find(quote, 1)
                if end == -1 or (end + 1 < len(remaining) and not remaining[end + 1].isspace()):
                    raise unsupported(remaining)
                literal = remaining[:end + 1]
                pattern = literal[1:-1]
                remaining = remaining[end + 1:].lstrip()
            else:
                parts = remaining.split(maxsplit=1)
                literal = pattern = parts[0]
                remaining = parts[1] if len(parts) == 2 else ""
            # Quoted paths with spaces work. Go string escapes, globs, all: and
            # non-canonical paths need a resolver this COPY-source check lacks.
            if (not pattern or pattern.startswith("all:")
                    or any(char in pattern for char in '*?[\\"`')
                    or any(part in ("", ".", "..") for part in pattern.split("/"))):
                raise unsupported(literal)
            patterns.append(pattern)
    return patterns


def check_backend_builder_inputs(dockerfile: str, source: str) -> None:
    """Check identity source and every embed using strings, without filesystem writes."""
    source_path = Path("server_tools/repository_details.go")
    embeds = embed_patterns(source, source_path.as_posix())
    if not embeds:
        raise AssertionError(f"{source_path}: no //go:embed patterns found")
    copies = builder_copies(dockerfile, "backend-builder")
    for path in [source_path, *(source_path.parent / name for name in embeds)]:
        name = path.as_posix()
        if not any(name == copied or name.startswith(copied + "/") for copied in copies):
            raise AssertionError(f"backend-builder is missing {name}")


def build_input_regression_cases(dockerfile: str, source: str) -> list[tuple]:
    """Keep the gate's 28 byte mutations and extra subset refusals reproducible."""
    backend = "COPY server_tools/repository_details.go server_tools/repo_details.json ./server_tools/\n"
    frontend = (
        "COPY backend/core_components/frontend_assets/shell_boot_recovery.js "
        "backend/core_components/frontend_assets/shell_boot_recovery.css ./backend/core_components/frontend_assets/\n"
    )
    headers = {
        stage: next(line for line in dockerfile.split("\n") if line.endswith(f" AS {stage}"))
        for stage in ("backend-builder", "frontend-builder")
    }
    cases = []

    def add(name, result, *, document=dockerfile, go_source=source):
        cases.append((name, document, go_source, result))

    def change(name, old, new, result="EE", document=dockerfile):
        if document.count(old) != 1:
            raise AssertionError(f"regression fixture {name!r} must replace exactly one input")
        add(name, result, document=document.replace(old, new))

    add("Current files", "PP")
    change("Baseline Dockerfile", "# The backend embeds the public repository identity used for release checks.\n" + backend, "", "FP")
    change("Identity COPY removed", backend, "", "FP")
    for name, directive, result in (
        ("New single-pattern uncopied embed", "//go:embed missing.json", "FP"),
        ("New multi-pattern uncopied embed", "//go:embed repo_details.json missing.json", "FP"),
        ("New directive with two spaces", "//go:embed  missing.json", "FP"),
        ("Unsupported embed syntax", "//go:embed *.json", "EP"),
        ("Uncopied embed after CR", "//go:embed repo_details.json \r missing.json", "FP"),
        ("Unsupported embed after CR", "//go:embed repo_details.json \r *.json", "EP"),
    ):
        add(name, result, go_source=source + "\n" + directive + "\n")
    add("Go source with CRLF", "PP", go_source=source.replace("\n", "\r\n"))
    change("Identity COPY behind comment + CR", backend, "# gate comment \r" + backend, "FP")
    change("Vite COPY behind comment + CR", frontend, "# gate comment \r" + frontend, "PF")
    add("Dockerfile with CRLF", "PP", document=dockerfile.replace("\n", "\r\n"))
    for stage, result in (("backend-builder", "FP"), ("frontend-builder", "PF")):
        change(f"{stage.split('-')[0].title()} FROM behind comment + CR",
               headers[stage], "# gate comment \r" + headers[stage], result)
    change("CR between backend COPY arguments", backend, backend.replace(" ./", " \r ./"), "PP")
    change("CR between frontend COPY arguments", frontend, frontend.replace(" ./", " \r ./"), "PP")
    change("Backend COPY continued from RUN with backslash", backend, "RUN true \\\n" + backend)
    change("Frontend COPY continued from RUN with backslash", frontend, "RUN true \\\n" + frontend)
    change("Valid backend COPY split with backslash", backend, backend.replace(" ./", " \\\n ./"))
    add("Syntax directive alone", "EE", document="# syntax=docker/dockerfile:1\n" + dockerfile)
    change("Syntax directive plus swallowed backend COPY", backend, "RUN true \\\n" + backend,
           document="# syntax=docker/dockerfile:1\n" + dockerfile)
    backtick = "# escape=`\n" + dockerfile.replace("\\\n", "`\n")
    add("Backtick escape with existing continuations converted", "EE", document=backtick)
    change("Backtick RUN absorbs backend COPY", backend, "RUN true `\n" + backend, document=backtick)
    change("Backtick RUN absorbs frontend COPY", frontend, "RUN true `\n" + frontend, document=backtick)
    change("Backend COPY moved behind lowercase FROM", backend, "from alpine AS gate-decoy\n" + backend)
    change("Frontend COPY moved behind tab-separated FROM", frontend, "FROM\talpine AS gate-decoy\n" + frontend)
    change("Lowercase backend target-stage header", headers["backend-builder"], headers["backend-builder"].lower())

    # These additional rows exercise each refusal beyond the original gate.
    for name, replacement in (
        ("Mixed-case COPY", backend.replace("COPY", "CoPy", 1)),
        ("Indented COPY", " " + backend),
        ("Double-space COPY", backend.replace("COPY ", "COPY  ", 1)),
        ("Tab-separated COPY", backend.replace("COPY ", "COPY\t", 1)),
        ("JSON-form COPY", 'COPY ["server_tools/", "./server_tools/"]\n'),
        ("Unknown COPY flag", backend.replace("COPY ", "COPY --chown=1000 ", 1)),
        ("COPY heredoc", "COPY <<EOF ./server_tools/\n" + backend + "EOF\n"),
        ("COPY variable", backend.replace("server_tools/repo_details.json", "$IDENTITY")),
        ("Quoted COPY path", backend.replace("server_tools/repo_details.json", '"server_tools/repo_details.json"')),
        ("COPY parent path segment", backend.replace("server_tools/repo_details.json", "server_tools/../repo_details.json")),
        ("Unlisted COPY wildcard", backend.replace("server_tools/repo_details.json", "server_tools/*.json")),
        ("COPY variable --from", backend.replace("COPY ", "COPY --from=$STAGE ", 1)),
        ("COPY missing destination", "COPY server_tools/\n"),
        ("COPY escaped path", backend.replace("server_tools/repo_details.json", r"server_tools/repo\_details.json")),
        ("COPY through blank/comment continuation", "RUN true \\\n\n# comment\n" + backend),
        ("Backtick COPY without directive", backend.rstrip("\n") + "`\n"),
        ("Non-ASCII COPY separator", backend.replace("COPY ", "COPY\u00a0", 1)),
        ("Control-character COPY separator", backend.replace("COPY ", "COPY\v", 1)),
    ):
        change(name, backend, replacement)
    header = headers["backend-builder"]
    change("Continuation on FROM", header, header + " \\\n extra")
    change("FROM reached through continuation", header, "RUN true \\\n" + header)
    change("FROM variable image", header, "FROM $IMAGE AS backend-builder")
    change("Duplicate stage alias", backend, header + "\n" + backend)
    for name, extra in (
        ("RUN heredoc", "RUN <<EOF\n" + backend + "EOF\n"),
        ("Unknown parser directive", "# check=skip=all\n"),
        ("Unlisted ONBUILD instruction", "ONBUILD " + backend),
        ("Lowercase RUN instruction", "run true\n"),
        ("Dangling continuation", "RUN true \\\n"),
        ("WORKDIR continuation", "WORKDIR /app \\\n extra\n"),
        ("Continuation with trailing spaces", "RUN true \\ \n extra\n"),
        ("Double-backslash continuation", "RUN true \\\\\n extra\n"),
    ):
        add(name, "EE", document=dockerfile + extra)
    return cases


class DockerFrontendBuildInputTests(unittest.TestCase):
    def mock_input_bytes(self, path: Path, content: bytes, additional=None):
        """Replace selected inputs in memory; preserve unrelated reads and restore."""
        read_bytes = Path.read_bytes
        inputs = {path: content, **(additional or {})}
        return patch.object(
            Path, "read_bytes", autospec=True,
            side_effect=lambda requested: inputs[requested] if requested in inputs else read_bytes(requested),
        )

    def test_backend_builder_copies_repository_identity_and_embedded_files(self) -> None:
        check_backend_builder_inputs(
            load_dockerfile(),
            load_repository_details_source(),
        )

    def test_gate_matrix_through_both_real_byte_loaders(self) -> None:
        checks = (
            self.test_backend_builder_copies_repository_identity_and_embedded_files,
            self.test_every_application_file_the_vite_configuration_reads_is_copied,
        )
        for name, dockerfile, source, expected in build_input_regression_cases(
            load_dockerfile(), load_repository_details_source(),
        ):
            for check, outcome in zip(checks, expected):
                with self.subTest(mutation=name, check=check.__name__):
                    with self.mock_input_bytes(
                        APP / "docker/Dockerfile", dockerfile.encode("utf-8"),
                        {APP / "server_tools/repository_details.go": source.encode("utf-8")},
                    ) as read:
                        if outcome == "P":
                            check()
                        elif outcome == "F":
                            with self.assertRaises(AssertionError):
                                check()
                        else:
                            with self.assertRaises(ValueError) as failure:
                                check()
                            self.assertRegex(str(failure.exception),
                                             r"^(docker/Dockerfile|server_tools/repository_details.go):\d+: unsupported .+")
                        read.assert_any_call(APP / "docker/Dockerfile")
                        if check == checks[0]:
                            read.assert_any_call(APP / "server_tools/repository_details.go")

    def test_loaded_uncopied_pattern_after_carriage_return_fails(self) -> None:
        source = load_repository_details_source() + (
            "\n//go:embed repo_details.json \r run_filterest_docker.sh\nvar gateExtra embed.FS\n"
        )
        with self.mock_input_bytes(APP / "server_tools/repository_details.go", source.encode("utf-8")) as read:
            with self.assertRaisesRegex(AssertionError, "backend-builder is missing server_tools/run_filterest_docker.sh"):
                self.test_backend_builder_copies_repository_identity_and_embedded_files()
            read.assert_any_call(APP / "server_tools/repository_details.go")

    def test_loaded_unsupported_pattern_after_carriage_return_fails(self) -> None:
        source = load_repository_details_source() + "\n//go:embed repo_details.json \r *.json\n"
        line = source.count("\n")
        with self.mock_input_bytes(APP / "server_tools/repository_details.go", source.encode("utf-8")) as read:
            with self.assertRaises(ValueError) as failure:
                self.test_backend_builder_copies_repository_identity_and_embedded_files()
            read.assert_any_call(APP / "server_tools/repository_details.go")
        self.assertEqual(
            str(failure.exception),
            f"server_tools/repository_details.go:{line}: unsupported embed pattern '*.json'",
        )

    def test_loaded_crlf_directive_passes(self) -> None:
        source = load_repository_details_source().replace("\n", "\r\n")
        with self.mock_input_bytes(APP / "server_tools/repository_details.go", source.encode("utf-8")) as read:
            self.test_backend_builder_copies_repository_identity_and_embedded_files()
            read.assert_any_call(APP / "server_tools/repository_details.go")

    def test_loaded_copy_behind_comment_carriage_return_fails(self) -> None:
        dockerfile = load_dockerfile()
        for copy, check, message in (
            (
                "COPY server_tools/repository_details.go server_tools/repo_details.json ./server_tools/\n",
                self.test_backend_builder_copies_repository_identity_and_embedded_files,
                "backend-builder is missing server_tools/repository_details.go",
            ),
            (
                "COPY backend/core_components/frontend_assets/shell_boot_recovery.js "
                "backend/core_components/frontend_assets/shell_boot_recovery.css ./backend/core_components/frontend_assets/\n",
                self.test_every_application_file_the_vite_configuration_reads_is_copied,
                "frontend-builder stage does not copy it",
            ),
        ):
            with self.subTest(copy=copy):
                self.assertEqual(dockerfile.count(copy), 1)
                mutated = dockerfile.replace(copy, "# gate comment \r" + copy)
                with self.mock_input_bytes(APP / "docker/Dockerfile", mutated.encode("utf-8")) as read:
                    with self.assertRaisesRegex(AssertionError, message):
                        check()
                    read.assert_any_call(APP / "docker/Dockerfile")

    def test_loaded_stage_behind_comment_carriage_return_fails(self) -> None:
        dockerfile = load_dockerfile()
        for stage, check in (
            ("backend-builder", self.test_backend_builder_copies_repository_identity_and_embedded_files),
            ("frontend-builder", self.test_every_application_file_the_vite_configuration_reads_is_copied),
        ):
            with self.subTest(stage=stage):
                header, = (
                    line for line in dockerfile.split("\n")
                    if line.startswith("FROM ") and line.rstrip().endswith(f" AS {stage}")
                )
                mutated = dockerfile.replace(header, "# gate comment \r" + header)
                with self.mock_input_bytes(APP / "docker/Dockerfile", mutated.encode("utf-8")) as read:
                    with self.assertRaisesRegex(AssertionError, stage):
                        check()
                    read.assert_any_call(APP / "docker/Dockerfile")

    def test_loaded_crlf_dockerfile_passes(self) -> None:
        dockerfile = load_dockerfile().replace("\n", "\r\n")
        with self.mock_input_bytes(APP / "docker/Dockerfile", dockerfile.encode("utf-8")) as read:
            self.test_backend_builder_copies_repository_identity_and_embedded_files()
            self.test_every_application_file_the_vite_configuration_reads_is_copied()
            read.assert_has_calls([
                call(APP / "docker/Dockerfile"),
                call(APP / "server_tools/repository_details.go"),
                call(APP / "docker/Dockerfile"),
            ])

    def test_every_application_file_the_vite_configuration_reads_is_copied(self) -> None:
        config = (APP / "frontend/vite.config.mjs").read_text(encoding="utf-8")
        read = re.findall(r"readFileSync\(join\(canonicalApplicationRoot, '([^']+)'\)", config)
        self.assertTrue(read, "vite.config.mjs no longer reads application files the way this test expects")
        copies = builder_copies(load_dockerfile(), "frontend-builder")
        for path in read:
            self.assertTrue(
                any(path == copied or path.startswith(copied + "/") for copied in copies),
                f"vite.config.mjs reads {path}, but the frontend-builder stage does not copy it",
            )


class EmbedPatternTests(unittest.TestCase):
    SOURCE = "package repodetails\n//go:embed repo_details.json\nvar identity []byte\n"
    DOCKERFILE = (
        "FROM golang AS backend-builder\n"
        "COPY server_tools/repository_details.go server_tools/repo_details.json ./server_tools/\n"
    )

    def test_carriage_return_keeps_both_patterns_on_the_directive(self) -> None:
        source = self.SOURCE + (
            "\n//go:embed repo_details.json \r run_filterest_docker.sh\nvar gateExtra embed.FS\n"
        )
        self.assertEqual(embed_patterns(source, "identity.go"), [
            "repo_details.json", "repo_details.json", "run_filterest_docker.sh",
        ])

    def test_unsupported_pattern_after_carriage_return_fails(self) -> None:
        source = self.SOURCE + "//go:embed repo_details.json \r *.json\n"
        with self.assertRaises(ValueError) as failure:
            embed_patterns(source, "identity.go")
        self.assertEqual(str(failure.exception), "identity.go:4: unsupported embed pattern '*.json'")

    def test_crlf_directive_passes(self) -> None:
        source = self.SOURCE.replace("\n", "\r\n")
        self.assertEqual(embed_patterns(source, "identity.go"), ["repo_details.json"])
        check_backend_builder_inputs(self.DOCKERFILE, source)

    def test_all_directives_and_patterns_are_enumerated(self) -> None:
        source = (
            self.SOURCE
            + '\t//go:embed\t "assets/with spaces.json" \t`assets/another file.json`\n'
            + '//go:embed  assets/one.json\tassets/two.json  \n'
        )
        self.assertEqual(embed_patterns(source, "identity.go"), [
            "repo_details.json", "assets/with spaces.json", "assets/another file.json",
            "assets/one.json", "assets/two.json",
        ])
        check_backend_builder_inputs(
            self.DOCKERFILE + "COPY server_tools/assets/ ./server_tools/assets/\n", source,
        )

    def test_uncopied_patterns_fail(self) -> None:
        for directive in (
            "//go:embed missing.json",
            "//go:embed repo_details.json missing.json",
            "//go:embed  missing.json",
            "//go:embed\t repo_details.json \t missing.json",
            '//go:embed "repo_details.json" `missing.json`',
        ):
            with self.subTest(directive=directive):
                with self.assertRaisesRegex(AssertionError, "backend-builder is missing server_tools/missing.json"):
                    check_backend_builder_inputs(self.DOCKERFILE, self.SOURCE + directive + "\n")

    def test_missing_source_or_identity_copy_fails(self) -> None:
        for copied in ("", "server_tools/repository_details.go", "server_tools/repo_details.json"):
            with self.subTest(copied=copied):
                copy = f"COPY {copied} ./server_tools/\n" if copied else ""
                dockerfile = f"FROM golang AS backend-builder\n{copy}"
                with self.assertRaisesRegex(AssertionError, "backend-builder is missing server_tools/"):
                    check_backend_builder_inputs(dockerfile, self.SOURCE)

    def test_unsupported_patterns_fail_with_source_location(self) -> None:
        for pattern in (
            "*.json", "details?.json", "details[12].json", "all:assets", '"*.json"',
            '"unterminated', '`unterminated', '"repo_details.json"missing.json',
            r'"repo\x5fdetails.json"', r'"repo\"details.json"',
            "../outside.json", "/absolute.json", "assets//details.json", '""', "",
        ):
            with self.subTest(pattern=pattern):
                with self.assertRaises(ValueError) as failure:
                    check_backend_builder_inputs(self.DOCKERFILE, self.SOURCE + f"//go:embed {pattern}\n")
                self.assertIn("server_tools/repository_details.go:4: unsupported embed pattern", str(failure.exception))
                self.assertIn(repr(pattern or "<empty directive>"), str(failure.exception))

    def test_missing_directives_fail(self) -> None:
        with self.assertRaisesRegex(AssertionError, "no //go:embed patterns found"):
            check_backend_builder_inputs(self.DOCKERFILE, "package repodetails\n")


if __name__ == "__main__":
    unittest.main()
