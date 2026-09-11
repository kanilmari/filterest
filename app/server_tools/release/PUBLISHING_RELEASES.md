# Publishing a verified standalone release

The public publication command publishes a new Filterest version to
`kanilmari/filterest` from the repository's clean `main` branch. It needs the
maintainer's existing Git and GitHub CLI authentication; it never reads private
installation credentials or requires another source repository.

Use the source sequence described by [candidate preparation](PREPARING_RELEASES.md)
and [candidate promotion](PROMOTING_RELEASES.md): reviewed source **S**, candidate
metadata commit **C**, then published identity commit **P**. Promotion changes
only the release ledger and build identity between C and P. Rebuild the final
assets from P before publication, because candidate binaries embed C.

## Plan and apply

From the Filterest installation root, run `./filterest release publish` with
`--expect-version <version>`, `--published-commit <full-commit>`,
`--assets-dir /absolute/path/to/final-assets`, and `--json`. Read
`app/VERSION_APP` and use the exact reviewed published identity commit.

Planning performs local verification and GitHub/Git remote reads. It does not
push, create a local tag, create a release, upload, change Actions settings, or
deploy anything. Long option names must be complete. The target defaults to
this installation; `--target` explicitly selects another standalone checkout
without copying or reconstructing it.

To perform the authorized publication, repeat the same command with `--apply`.
An existing local or remote version tag, or a GitHub release for that tag,
always stops the command. There is no force, clobber, overwrite, delete or
automatic resume mode.

Before writing, publication verifies:

- The current branch is `main`, HEAD is the supplied full commit, the working
  tree is clean, and both fetch and push use one approved GitHub URL for the
  repository.
- The candidate/published history, current compatibility record, bootstrap,
  release ledger, build identity and expected version agree.
- All fourteen distributed files match the [Linux asset contract](BUILDING_LINUX_ASSETS.md).
  Their checksums, source notices, archive members, Go dependencies, binary Git
  revision, clean build marker and glibc boundary are checked again.
- The authenticated GitHub account is `kanilmari`. Every owned repository,
  including private and archived repositories, has Actions disabled except the
  approved `kanilmari/try_it_html` exception. Pagination, authentication and
  unknown settings fail closed. The account response must prove a classic or
  OAuth token with the `repo` scope, which can enumerate all owned private
  repositories. Fine-grained or narrower tokens are refused when full account
  visibility cannot be proved; the tool never widens token permissions itself.
- The remote `main` commit can fast-forward to P, and the version tag/release is
  absent. If the remote commit is unavailable locally, fetch and reconcile it
  first; a failed read is never treated as an empty remote.

## Remote sequence and receipt

The command repeats its preflight, then pushes the exact main and version-tag
refs together with a normal atomic Git push. It does not create a local tag.
It reads the remote refs back, creates a draft release using reviewed source
release notes, and uploads the exact verified files without overwrite flags.
Every remote asset is downloaded and hashed, with complete filename equality
required. The source and account policy are checked again before publishing the
draft. A final readback verifies public release state, tag, branch and all asset
hashes.

Only that complete readback reports `publication_verified: true`. Keep the
successful JSON output as an ignored local receipt, for example under
`data/release/<version>/`. It contains the source-history bindings, final binary
metadata, account-policy inventory and remote asset hashes. A local ledger's
published identity alone does not prove that GitHub publication succeeded.

If any step fails, the error reports the last attempted remote phase and any
known release ID. A timeout may mean an operation succeeded remotely even when
the response was lost. The tool does not delete a draft, retract a tag, undo a
push, or overwrite assets. Inspect the reported remote state and retain the
failure evidence. A rerun will stop on the existing tag/release so that partial
state cannot be silently replaced.

The account audit is also available independently through
`python3 app/server_tools/release/github_actions_policy.py --owner kanilmari --allow-enabled kanilmari/try_it_html --json`.

This publication changes source and release-file storage only. Customer-site
updates retain their separate target selection and recovery procedure.
