# Filterest Documentation

Filterest documentation is maintained directly in this repository together with
its source and development tools.

- [The main README](../../README.md) describes installation, development commands,
  and the portable `app/` plus operator-directory layout.
- [The Constitution](constitution/constitution.md) defines the product principles.
- [Contribution guidance](../../CONTRIBUTING.md) explains how to propose changes.
- [The project model](instructions_and_documentation/Filterest_Project_Model.md)
  distinguishes current project capabilities from proposed future architecture.
- [Publishing Filterest](publication/PUBLISHING.md) separates ordinary source
  development from versioned release assembly. Other files in `publication/`
  retain release-specific evidence and review records; historical generation
  descriptions do not authorize replacing the maintained checkout.

Technical guides, design proposals, reference implementations, and tests live
under `app/`. A proposal describes intended behavior until its implementation
and validation are recorded; reading a design document does not make a feature
available or authorize migrating existing data.

Queen, database-backed development tasks, and the Workline Observatory ship as
Filterest capabilities. Their records and local worker output belong to the
installation's ignored database and runtime storage. Optional worker commands
also need a separately installed and authenticated AI command-line client.
Project-specific applications, credentials, private data, and operational
records are not public product source.

Commands are supported here only when their implementation is present in this
repository. Normal development must not depend on a separate maintainer
repository. New contributors may clone the public repository; an established
authoritative checkout must retain its own history and local work rather than
being regenerated or replaced by another copy.

Development setup uses the Go version declared in `app/go.mod`. If that version
is absent from `PATH`, it reads the matching Linux archive checksum from the
[official Go release metadata](https://go.dev/dl/?mode=json&include=all), verifies
the downloaded archive, and only then installs the user-owned toolchain. Missing
or inconsistent release metadata and failed checksums stop setup without
replacing an existing toolchain. After correcting a network problem, rerun
`./filterest setup --profile development --dependencies-only --yes` to complete
development dependencies while preserving settings, databases and services.
