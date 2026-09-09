# Filterest release notes

## 9.3.3

Database compatibility: **9.7.13**. No database migration is introduced.

- Filterest is maintained directly in its own repository and can install its
  development dependencies without a parent development workspace.
- The development setup installs Node packages, Go caches, Python test tools
  and Playwright browsers under ignored runtime storage. Owned scripts and
  dependency manifests remain in source control.
- `./filterest setup --profile development --dependencies-only --yes`
  reconciles development dependencies on an already configured host without
  changing its database, credentials or running services.
- Repeated installation reuses verified matching Node dependencies. The
  dependency receipt follows the selected build manifests, including composed
  development builds.
- Playwright is pinned to 1.60.0 to fix browser installation with the current
  Node development toolchain.
- The approved product Constitution, contribution guidance and publication
  checklist now describe the independently maintained Filterest product.

Existing installations retain their data and settings. The Linux administrator
binaries require glibc 2.34 or newer. Host tools and operating-system prerequisites
remain installation requirements; they are not bundled into the source repository.
