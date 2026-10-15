<!-- Describes stable identities and publication for site information and notices. -->
<!-- Connects structured owner settings, templates, login and About. -->
<!-- Keeps published wording consistent and recoverable across presentation surfaces. -->
<!-- Covers missing notice management beyond the existing editable content rows. -->

# Site Notices

## What it makes possible

An owner prepares About information, privacy notices and cookie notices from
structured installation settings and editable multilingual templates. They
preview the result before publishing, and login and About show the same
published version of each notice.

The [ordinary site-notice workflow](../instructions_and_documentation/Core_Workflows.md#site-notices)
describes the existing editable content and login display. This feature adds
stable document kinds, preparation and publication instead of relying on
particular content row numbers.

## Concepts

- **Document kind:** a stable meaning such as About, privacy or cookies,
  independent of a row number, ordering or translated title.
- **Notice configuration:** owner-reviewed facts used to prepare the wording,
  including the site's identity, purposes and relevant services.
- **Template and draft:** multilingual starting text and its editable result,
  with a preview showing what readers will receive.
- **Published version:** immutable wording for a kind and its languages;
  later edits create a new version rather than changing an earlier one.
- **Cookie catalogue:** the site's cookies and their purposes, providers,
  lifetimes and conditions of use, feeding the cookie notice.

## General data model

Each document kind has drafts and published versions. A publication selection
identifies the version readers receive across every surface. Templates use
structured configuration and cookie catalogue entries; publication retains the
reviewed result even if those inputs later change.

## Implementation principles

Use the same publication selection on login and About, with explicit language
fallbacks. Keep About as the English navigation name and Tietoa as its Finnish
equivalent, separate from individual document titles. Templates aid the owner;
they must not claim that unavailable site features or services are in use.
