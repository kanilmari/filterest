# Python Test Categories

`python -m pytest app/testing/python` collects automated tests only. The category
summary printed at the end explains what those tests belong to:

- `release-artifact`: Filterest generation/publication, public bootstrap, and
  release-evidence contracts.
- `agent-workflow`: an extension category for downstream maintainer suites; a
  plain Filterest checkout may collect zero tests in this category.
- `platform-tooling`: the remaining local platform, migration,
  shell-compatibility, and validation helpers.

Run one category with:

```bash
python -m pytest app/testing/python --python-category release-artifact
python -m pytest app/testing/python --python-category agent-workflow
python -m pytest app/testing/python --python-category platform-tooling
```

These are ownership/reporting categories, not claims about process isolation.
Some automated tests use temporary subprocesses, Git repositories, or files,
but the collection does not start the real Filterest backend, frontend, or
database. Operator-invoked scripts that may start services or write through
live APIs have separate dependencies and do not belong to this collection.
