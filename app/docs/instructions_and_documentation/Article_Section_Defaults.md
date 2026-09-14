<!-- Article_Section_Defaults.md -->
<!-- Defines dataset-level initial states for article collapsible blocks. -->
<!-- Connects the existing field-settings administrator and article renderers. -->
<!-- Keeps initial defaults independent of field visibility and reading-time choices. -->

# Article collapsible-block defaults

In **View field settings**, select a dataset and the **Article** view. The
**Article collapsible blocks** panel has its own presentation selector, Save
button and Restore action. Its settings apply to every reader of that dataset;
the field-set user-group selection does not change this scope.

- **Traditional article** supports Details, Images, Attachments, Related rows
  and Task progress.
- **Image-first article (IFAV)** supports Details. This option never hides its
  article image or changes image-first navigation.
- A missing setting means **open**. An explicitly closed block keeps its
  heading and opening control visible.
- Cards, compact article lists and tables keep their current behavior.

Each new article opening reads the defaults for that dataset and presentation.
A reader can open or close a block normally; these reading actions do not save
administrator settings. A media refresh within the same article preserves its
current open/closed state. A newly opened article starts from the saved defaults.

The administrator's unsaved drafts are kept separately for each dataset and
presentation while that editor remains mounted. Language changes preserve the
draft. Save sends only changed section booleans, then verifies the exact API
readback before showing success. Restore removes only the selected
presentation's overrides, so its blocks again default to open. The other
presentation, dataset, field assignments and user groups are unchanged.

The canonical storage is
`system_db_tables.article_section_initial_open`, a JSON object with optional
`classic` and `image_first` objects. Only the supported section keys and boolean
values are accepted. The supported API is:

- `GET /api/view-field-settings/article-section-defaults?dataset=<name>&presentation_key=classic|image_first`
- `POST /api/admin/view-field-settings/article-section-defaults`, containing
  `dataset`, `presentation_key`, and either a nonempty `initial_open` boolean
  patch or `reset_to_defaults: true`.

Reads require permission to read the dataset. Mutations require administrator
access and the normal CSRF protection. Each patch/reset is transactional and
preserves other presentation keys. The response separates raw `overrides` from
effective `initial_open` values; absence is resolved as open on the server.
