<!-- AGENTS.md: instructions for AI assistants working in the Filterest repository. -->
<!-- It connects an assistant with the product's own rules, guides and verification path. -->
<!-- It travels with source installations and public releases. -->
<!-- Keep it limited to what this repository itself owns; maintenance-shell rules live elsewhere. -->

# Filterest — AI Assistant Guidelines

Filterest is a **multilingual database management tool and application
platform**. This file is the entry point for an assistant working in this
repository. Everything here applies to the product itself and needs no other
repository.

## Start Here

Read before changing anything:

- [README.md](README.md) — what the product is, how it is installed and run.
- [The Filterest Constitution](app/docs/constitution/constitution.md) — the
  supreme law of this project.
- [Developer Guide](app/docs/instructions_and_documentation/DEV_GUIDE.md) —
  technical rules, commands and conventions.
- [Dictionary](app/docs/instructions_and_documentation/Dictionary.md) — the
  shared product and interface terms.
- [Documentation index](app/docs/README.md) — the architecture, permission,
  frontend and dataset-creation guides.
- [CHANGELOG.md](CHANGELOG.md) — what each released version changed. Record a
  change that alters shipped behaviour under `[Unreleased]` when it is accepted.

## Absolute Rules

### No direct SQL modifications

Never run an ad hoc `CREATE`, `ALTER`, `UPDATE`, `INSERT`, `DELETE` or `DROP`
to change application data or schema. You are changing **an application that
uses a database**, not the database itself. If an endpoint does not work, fix
the endpoint. Read-only `SELECT` for inspection is the only ad hoc SQL allowed.
Shared schema and data changes belong in a migration under
`app/server_tools/migrations/`.

### Every change keeps the product multilingual and themeable

Interface text comes from language keys, never from hardcoded copy in a
component. A changed interface surface must keep working in both the light and
the dark theme, including when the operating system's theme differs from the
application's own override, and with translated copy in place.

### Native-first development

Develop and verify against the local native instance rather than a container.
Docker instances are deployment targets. After backend changes, build and
restart the running instance yourself and confirm the exact changed behaviour at
the URL you report; do not leave that step to the person reviewing.

### No GitHub Actions

This repository does not run GitHub Actions. Tests, builds, checksums and
release assembly run locally. Do not add `.github/workflows/*`.

## How To Work

1. **Orient.** Confirm the branch, and understand the real task rather than the
   visible symptom.
2. **Plan.** Read the relevant
   [reference implementations](app/docs/reference_implementations/) before
   writing new code, and follow them rather than an arbitrary local pattern.
3. **Work.** Narrate progress. Leave code comments, documentation updates and
   notes that make the next change easier.
4. **Verify.** Match verification to the risk: a unit or regression test for
   logic, a targeted browser proof for layout, theme or multi-element interface
   work. Run `npm run build` after file moves or renames. Passing tests alone
   are not proof — check the likely regressions too.
5. **Capture knowledge.** Update the document that is now wrong, rather than
   adding a new one beside it.
6. **Close.** Commit and push only what the person asked for, on `main` unless
   told otherwise.

## Processes Age; Do Not Assume Ours Is Correct

A documented process was right when someone asked for it, and it can be wrong
today. Treat every instruction here as reviewable, including this one.

- When a required step fails for a structural reason, or forces a state another
  required check rejects, stop and say so. Do not quietly work around it, and do
  not present the resulting broken state as expected.
- Name the conflict in plain language, say which two rules meet at it, and
  propose the smallest change that removes it. The person decides.
- A process that needs several manual steps to reach one consistent state is a
  defect in the process, not the operator's problem.
- Record the correction where the instruction lives, so the next session
  inherits the fixed process instead of the workaround.

## How To Write To The Person

Write for a product owner, not a developer peer. Lead with the plain-language
meaning, the effect, the current state and the decision needed. Never use a bare
code identifier, environment variable, database field or script name as though
its meaning were self-evident: name the concept first and put the exact
identifier in parentheses when it helps. Answer "what changed?", "why does it
matter?", "is anything blocked?" and "what is needed next?" before describing
files and commands. Never claim completion you have not verified; say what you
actually checked.

## Relationship To The Maintenance Shell

Some installations compose Filterest from a private maintenance shell that adds
operations, release and workline tooling. That shell may compose Filterest;
Filterest must never require it. Ordinary development, testing, building and
releasing in this repository must work from this repository alone. When a
document you need is maintained in that shell, name it in words rather than
linking into a path that a public checkout does not have.
