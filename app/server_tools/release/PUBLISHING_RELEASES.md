<!-- PUBLISHING_RELEASES.md -->
<!-- Defines owner terminal signing and independently authenticated publication. -->
<!-- Connects reviewed source/payload contracts with exact remote readback. -->
<!-- Preserves existing release history and keeps signing custody with the owner. -->
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

## Owner signing and independently provisioned trust

Final publication requires the [unsigned bundle contract](BUILDING_LINUX_ASSETS.md#final-unsigned-source-and-oci-bundle),
including source and any managed OCI images. The owner runs the existing
`release_signing` command directly in their own terminal, outside agent tools and
session recordings. K294 custody is a passphrase-protected encrypted container
on the owner's control workstation, outside repositories, with separately
protected offline recovery copies. Use an owner-only directory (0700) and
containers (0600). Public Filterest and private Easelect use independent keys.
The encrypted format remains unchanged; removable media is an optional recovery
location, not mandatory live custody.

The key-path setting `FILTEREST_RELEASE_SIGNING_KEY_FILE` (or the separate
`EASELECT_RELEASE_SIGNING_KEY_FILE`) selects a container, never a passphrase.
The owner builds the signer locally from reviewed source, then runs `keygen`
with `--product filterest --public-key-file /protected/public-key.txt` for initial
setup, and `fingerprint --product filterest` to authenticate the unlocked public
identity. Passphrases are entered only through the non-echoing controlling
terminal; flags, environment, stdin, files and agent messages cannot supply them.
No controlling terminal means refusal. Agents/build tools stop at unsigned output.

The owner signs the exact canonical UTF-8 manifest with final LF using:

```bash
/outside/reviewed-release-signing sign --product filterest \
  --input-file /outside/final-assets/release_manifest.v1.json \
  --output-file /outside/final-assets/release_signatures.v1.json
```

The signer validates composition/canonical bytes before unlocking and never
overwrites an output. Signing is domain-separated Ed25519 over the exact bytes,
including LF. One-image public output now has twenty files. Do not edit the
manifest or payloads after signing. Only the signed artifacts and public trust
policy are needed for subsequent verification/publication.

Provision public trust through an independently authenticated operator channel,
outside both source and bundle directories. Verify the full SHA-256 fingerprint
of the raw Ed25519 public key, composition, publisher, validity window and revoked
status. Actual owner fingerprints are recorded during owner setup, not invented
in source. The policy file must be regular, operator/root-owned, not writable by
group/others, and use no symlink path. Preserve the independent revision floor
outside release and database-restoration state. Bundled policies and public
test-only fixture keys cannot establish trust. See [SECURITY.md](../../../SECURITY.md#release-signing-and-trust)
for rotation, revocation and recovery.

## Plan and apply

From the Filterest installation root, run `./filterest release publish` with
`--expect-version <version>`, `--published-commit <full-commit>`,
`--assets-dir /absolute/path/to/final-assets`,
`--trust-policy /protected/operator-trust.json`,
`--minimum-trust-policy-revision <retained-floor>`, and `--json`. Read
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
- Independent live composition trust authenticates the exact canonical manifest
  before its instructions are interpreted. Missing, revoked, expired, rolled-back
  or wrong-composition trust stops publication before any remote mutation.
- The complete directory equals the signed artifact inventory plus manifest and
  detached signature envelope. Native assets retain the [Linux asset contract](BUILDING_LINUX_ASSETS.md);
  checksums, notices, complete source/archive membership, migration hashes,
  Go dependencies, binary Git identity, platform/ABI and OCI manifest/config/layer
  digests and identity labels are checked again. Public publication refuses
  private composition payloads. A bare native asset set is insufficient.
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
Every uploaded asset's name, size and available server digest are checked, then
every downloaded byte is checked for exact size and SHA-256. Complete filename
equality includes manifest and detached signatures. Source, signature trust,
payloads and account policy are checked again before publishing the
draft. A final readback verifies public release state, tag, branch and all asset
hashes.

Only that complete readback reports `publication_verified: true`. Keep the
successful JSON output as an ignored local receipt, for example under
`data/release/<version>/`. It contains the source-history bindings, final binary
metadata, signature fingerprints/trust revision, composition, complete local
inventory, account-policy inventory and remote asset hashes. A local ledger's
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
