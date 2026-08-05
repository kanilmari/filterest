# Filterest Documentation

This repository keeps two deliberately different documentation layers:

- Root files such as `README.md` and `SECURITY.md` introduce this generated
  stable Filterest repository. Release evidence and maintainer instructions live
  together under `docs/publication/`.
- The selected files under `docs/constitution/design/` and
  `docs/instructions_and_documentation/` are copied byte-for-byte from the
  Easelect development source because the same code and technical contracts
  apply to both repositories.

The shared files may therefore use the internal name **Easelect** for the
underlying platform, code identifiers, or target architecture. That wording is
intentional; it is not mechanically rewritten to Filterest. Commands are
publicly supported only when the referenced file is present in this repository.

Filterest intentionally omits Easelect-only ticketing, agent orchestration,
private applications, release-generation internals, and machine-specific
operations. Their documentation remains in Easelect and is not copied here.
