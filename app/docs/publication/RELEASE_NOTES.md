# Filterest release notes

## 9.3.4

Database compatibility: **9.7.13**. No database migration is introduced.

- Expired sessions open the localized sign-in flow and clear stale navigation
  aliases. Ordinary permission denials preserve the current guest view.
- Filterest now provides its own candidate preparation, Linux asset building,
  candidate promotion and GitHub publication commands. Preparation and
  publication plan their changes by default.
- Release verification binds all fourteen files to the reviewed source, checks
  dependency notices and binary compatibility, and verifies remote asset bytes
  before a draft can become a published release.
- Linux builds pin baseline processor requirements and refuse inherited
  machine-specific optimizations. The glibc 2.34 compatibility boundary remains.
- Development setup verifies the declared Go toolchain and uses the
  installation's isolated Python and other development dependencies.
- Transitional Easelect maintenance workspaces follow the same application
  release number. Standalone Filterest does not require that workspace.

Existing installations retain their data and settings. Preparing this candidate
and pushing its source do not update a running customer site.
