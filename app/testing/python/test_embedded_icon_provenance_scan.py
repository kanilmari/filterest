"""Verify that the embedded-icon provenance scan reads prose as prose.

The scan finds icon geometry written into source so a human reviews its licence
before publication. An apostrophe in an ordinary comment -- "the renderer's own
geometry" -- used to open a string literal that swallowed the rest of the file,
so every icon path after that comment escaped review while the scan reported
nothing wrong. That is the failure these tests pin.
"""
from server_tools.public_slice_export import generate_third_party_notices as notices

ICON_GEOMETRY = "M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"


def _paths(content: str) -> list[str]:
    return [kind for _, kind in notices.embedded_vector_matches(content, test_source=False)]


def test_icon_geometry_is_found_between_two_apostrophes_in_prose() -> None:
    # The real shape of the defect: one apostrophe opens the fake string and a
    # later one closes it, so everything between them -- the geometry included --
    # was read as a single literal and never examined.
    content = (
        "/**\n"
        " * Keeps the renderer's existing behaviour.\n"
        " */\n"
        f'const ICON_PATHS = ["{ICON_GEOMETRY}"];\n'
        "/** Build one renderer's element. */\n"
    )
    assert "svg-path-literal" in _paths(content)


def test_icon_geometry_is_found_between_two_apostrophes_in_line_comments() -> None:
    content = (
        "// This module owns the link icon's geometry.\n"
        f'const d = "{ICON_GEOMETRY}";\n'
        "// It is the caller's job to place it.\n"
    )
    assert "svg-path-literal" in _paths(content)


def test_ordinary_icon_geometry_is_still_found() -> None:
    assert "svg-path-literal" in _paths(f'const d = "{ICON_GEOMETRY}";\n')


def test_geometry_written_inside_a_comment_is_not_reported() -> None:
    # A path quoted in prose is documentation, not shipped geometry.
    content = f'// Upstream draws it as "{ICON_GEOMETRY}" in its own source.\n'
    assert _paths(content) == []


def test_a_string_containing_comment_markers_is_still_a_string() -> None:
    content = f'const note = "see http://example.invalid // not a comment";\nconst d = "{ICON_GEOMETRY}";\n'
    assert "svg-path-literal" in _paths(content)


def test_the_repository_itself_has_every_embedded_icon_under_review() -> None:
    # The scan and the reviewed record must name exactly the same files: an
    # unreviewed file would publish unexamined geometry, and a stale entry would
    # mean the scan can no longer see geometry a human once reviewed.
    source_root = notices.pathlib.Path(__file__).resolve().parents[3]
    discovered = notices.discover_embedded_vector_sources(source_root)
    provenance = notices.read_asset_provenance(source_root)
    reviewed = {
        record["path"]
        for record in provenance["files"]
        if record.get("kind") == "embedded-icon-source"
    }
    assert discovered == reviewed
