# Filterest Documentation

This repository keeps two deliberately different documentation layers:

- Root files such as `README.md` and `SECURITY.md` introduce the independently
  usable Filterest repository. Release evidence and maintainer instructions live
  together under `app/docs/publication/`.
- The files under `app/docs/constitution/design/` and
  `app/docs/instructions_and_documentation/` are maintained directly in the
  canonical `filterest/app/docs/` public-source subtree in the maintainer
  workspace and mirrored
  byte-for-byte to GitHub.

Commands are publicly supported only when the referenced file is present in
this repository.

Filterest intentionally omits non-public ticketing, agent orchestration,
private applications, release-generation internals, and machine-specific
operations. Their documentation remains outside this public source tree.
