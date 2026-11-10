# Filterest 9.6.3

Release date: 2026-11-10. Contains the six commits since 9.6.2.

## Database and rollback

Database **9.13.5 stays unchanged**, with minimum and target both **9.13.5**.
When upgrading from 9.6.2, no migration runs on the first start and no database
release record is added. A rollback to **9.6.2 keeps the same database**.

## Update checks

The update checker, installer, updater and publisher read the release source
from `app/server_tools/repo_details.json`. The default source is unchanged.
The update checker now follows at most one release API redirect, only within
the HTTPS origin configured in its build. This also works with GitHub
Enterprise: configure the repository host, owner and repository in that file
before building the binary. Enterprise API requests use that host's `/api/v3`
endpoint. Editing the file does not redirect an already built binary.

An operator whose release API redirects within that HTTPS origin can now get
the normal stable-version comparison. A second redirect, a change of origin,
a move to HTTP or a redirect URL containing user information is refused. The
checker reports update information as unavailable after a failed lookup; an
earlier successful result remains historical information, without an update
available marker. Keep any redirect to one hop within the configured HTTPS
origin, or correct the source configuration and rebuild. A failed check does
not prevent the application from operating and never installs an update.

## Docker image builds

Docker images build again from this release's source: the Go build stage
includes the tracked repository identity needed to compile the binary. This
matters for Docker installations and updates that build their image from
source. The image's binary embeds the same identity as a native build. The
omission arose while introducing that file in this release; upgrading from
9.6.2 needs no additional operator step.

## Articles and cards

Closing an article opened from a Home box returns visitors to Home. Closing
one opened from a dataset list returns to that list. Browser Back and Forward
restore the right row.

Cards listed in the Article presentation use the same field frames, icons and
grid as the selected standard or Glowy card style. They keep the Article
presentation's own field choices. Operators' existing style selection now
also controls those cards' appearance; their Article field choices are kept.

The Glowy card's title and description icons, and in both card styles the
title's dataset icon, stay at the top of their container when the title wraps
or the description runs over several lines. A short one-line description
stays centred next to its icon.

The site setting **Card description lines** (`card_description_lines`) now
governs the description in both card styles. Its default is **2 lines** and
its range is **1–12**, in steps of one. A description shown with its field
label used to stay at two lines whatever the setting; it now shows up to the
chosen number of lines, with longer text truncated. Other field values keep
their two-line preview.

## Release repository identity

Release checks, installer downloads and publication tools read the repository
identity from one tracked file, `app/server_tools/repo_details.json`. The
repository itself is unchanged. The Go binary embeds that identity at build
time; editing the file does not redirect an already built binary.

For updates, the checkout's origin must have one fetch URL identifying that
repository, matching the file’s host, owner and repository exactly. Accepted
forms are HTTPS with or without `.git`, or SCP-style and `ssh://` Git SSH
URLs as the `git` user with the `.git` suffix. The release repository override
(`FILTEREST_RELEASE_REPOSITORY`) must be unset, empty or exactly match the file's
`owner/repo` value. Conflicting origins or overrides are rejected before any
release evidence is fetched. Installer overrides follow the same rule.

A missing, unreadable or invalid identity file stops setup before binary
selection, including selection of a current or local binary. Correct that file
or the conflicting origin or override before retrying.
