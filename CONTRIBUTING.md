# Contributing

Thank you for considering feedback for Filterest. This repository is the
public application-platform distribution generated from the maintainer release
source.

Filterest is intended to be owner-led open source rather than a
contribution-driven or contribution-operated project. The public source is made
available for inspection, use under the GPLv2 license, reproducible bug
reports, setup feedback, and carefully scoped public review. It is not intended
to become a community-governed development workflow.

Public issues may be used for reproducible bugs, setup problems, documentation
corrections, and narrowly scoped feature feedback if issues are enabled for the
published repository. The same kinds of reports may also be sent to
`support@filterest.fi`. Maintainers do not routinely accept unsolicited public
pull requests as the operating model.

Please do not report security vulnerabilities in public issues. Use the private
disclosure process named in `SECURITY.md`.

## Good First Contributions

- Documentation fixes and setup clarifications.
- Reproducible bug reports with browser, OS, and database details.
- Small UI accessibility improvements.
- Tests that cover existing public behavior.
- Multilingual improvements, especially public UI copy and examples.

## Before Suggesting A Change

- Open or reference an issue when the change affects behavior, setup, or
  public APIs.
- Do not open a pull request unless a maintainer has requested one or the
  public project policy later changes to accept them routinely.
- Keep changes focused and explain the user-visible problem being solved.
- Do not include credentials, `.env` files, service account keys, database
  dumps, private media, customer data, or local runtime artifacts.
- Use synthetic sample data only.
- Preserve multilingual behavior. New user-facing text should be ready for
  translation instead of being hardcoded in one language.
- Run the relevant checks listed in `README.md` before requesting review.

## Public Slice Boundary

The non-public maintainer release source remains the source for non-exported
product work, private apps, deployments, experiments, and release preparation.
The public Filterest repository should stay clean and focused on the
redistributable application platform.

If you believe a missing feature belongs in public, open an issue describing the
use case. Maintainers will decide whether to export or reimplement it in a
public-safe form.
