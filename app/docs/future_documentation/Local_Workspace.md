<!-- Local_Workspace.md: describes a private workspace built around local files. -->
<!-- Connects an embedded storage engine with the existing dataset and asset models. -->
<!-- Keeps personal files, derived search data and portable locations on the owner's computer. -->
<!-- Defines a future capability without choosing packaging or a physical schema. -->

# Local Workspace

A future feature extending Filterest's existing dataset and asset capabilities.

## What it makes possible

A local workspace runs Filterest privately on one computer for one owner or a
few local users, without a separate database server. A chosen workspace folder
becomes data: its files and folders appear as rows with attachments, so lists,
cards, articles, filters and multilingual fields work for personal files as
they do for hosted datasets.

File locations remain relative to the workspace folder. Moving or backing up
the whole workspace carries its files and dataset information together without
depending on the original computer's absolute paths.

Extracted text, thumbnails and search indexes are built in the background and
stay on the computer. They can always be rebuilt from the files. Local search
and conversational retrieval use this derived data without sending file
content to an outside service; nothing leaves the workspace unless the owner
deliberately exports or shares it.

The local workspace is a way to run the same Filterest product. Its datasets
retain the meaning and behaviour of hosted datasets, including their views,
relations, multilingual values and permissions.

## Concepts

- **Local workspace:** the owner's private collection of datasets, files and
  derived data, used on one computer.
- **Workspace folder:** the chosen root for the portable collection; file
  locations are interpreted relative to it.
- **File or folder row:** an ordinary dataset record representing a workspace
  item and linking its file content through the asset model.
- **Derived data:** extracted text, thumbnails and indexes that support
  browsing and retrieval without becoming the authoritative file content.
- **Embedded storage engine:** local database storage, such as SQLite, that
  runs with the application instead of requiring a separate database server.

## Current foundations

The [portable installation model](../../../README.md#one-portable-filterest-folder)
already keeps an installation's source and operator-owned files together, but
the [installation options](../../../README.md#installation-options) use
PostgreSQL. They do not provide an embedded local file workspace.

The existing [asset-linking architecture](../instructions_and_documentation/Asset_Linking_Architecture.md)
owns how files relate to dataset rows, and the
[permission model](../instructions_and_documentation/Permission_Model.md)
owns access. The local workspace extends these concepts to a chosen local
folder rather than introducing another file catalogue or permission system.

## General data model

| Conceptual record | Meaning and relationships |
| --- | --- |
| Workspace | The collection identity and chosen folder, containing datasets and workspace items. |
| Workspace item | A file or folder represented by a dataset row, with a location relative to the workspace folder and an asset relationship for file content. |
| Derived result | Extracted text, a thumbnail or an index associated with its source item and rebuildable from that source. |

Moving the workspace changes its root location, not its dataset or item
identities. Derived results can be discarded and rebuilt without losing the
source files or the owner's authored dataset values.

## Implementation principles

- **One application, replaceable storage:** introduce embedded storage behind
  a stated storage boundary. Keep local initialization, upgrades and recovery
  within the same product lifecycle rather than copying the application.
- **Equivalent dataset behaviour:** prove dataset reads and writes, filters,
  sorting, relations, multilingual values and attachment handling against both
  local and hosted storage engines. Storage differences must be explicit.
- **Bounded file access:** resolve relative locations within the chosen
  workspace and enforce the ordinary permission model when serving files or
  derived data; a file reference must not escape the workspace boundary.
- **Private runtime data:** local paths, files and indexes must never enter
  public seeds or hosted deployments through packaging or initialization.
