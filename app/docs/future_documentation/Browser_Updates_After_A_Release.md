<!-- Describes how a browser adopts the active Filterest interface after a release change. -->

# Browser Updates After a Release

A visitor who returns to an article after a site update should see the active
release with their usual browser settings. An ordinary reload of the same
address should load its current interface, even if the browser remembers the
previous one. Clearing site data or signing in again solely to see a style
change should be unnecessary. The same expectation applies when the site
restores an earlier release.

## Verifying a release change

The active release is the version the installation has selected to serve. A
tab may still be displaying the release it loaded before the switch. Filterest
already gives production scripts and styles addresses based on their contents.
The [guide to document startup and recovery](../instructions_and_documentation/Frontend_Document_Startup_And_Recovery.md)
describes how a page selects those files.

A release check should exercise that transition from a visitor's perspective.
For example, open an article before the switch, keep the browser's cache
enabled, then reload the same article after the switch. The page should use the
styles and scripts of the active release together. A visible change, such as
the appearance of a disabled image arrow, can confirm which interface the
visitor received. The check should cover both the public entry page and a
signed-in route, and repeat the transition for a rollback.

If a shared cache serves an outdated entry page, the installation should be
able to invalidate that page when the release changes. Unchanged images and
other reusable files can stay cached. A shared cache must continue to respect
which pages are private to a signed-in user.

## Tabs that are already open

An open tab could compare its loaded release with the site's active release
when the user returns to it. If they differ, the tab could offer a reload in
the user's language. A person editing a record should be able to finish or
save their work before accepting. After the reload, they should return to the
same address if their current permissions allow it. Comparing release
identities also lets an open tab recognise a rollback.
