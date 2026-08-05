# Python Test Categories

`python -m pytest testing/python` collects automated tests only. The category
summary printed at the end explains what those tests belong to:

- `release-artifact`: Filterest generation/publication, public bootstrap, and
  release-evidence contracts.
- `agent-workflow`: DB-backed task tooling plus Queen/worker orchestration.
- `platform-tooling`: the remaining local platform, migration, credential,
  shell-compatibility, and validation helpers.

Run one category with:

```bash
python -m pytest testing/python --python-category release-artifact
python -m pytest testing/python --python-category agent-workflow
python -m pytest testing/python --python-category platform-tooling
```

Translatorin ulkoisia ja mahdollisesti laskutettavia LLM-kutsuja tekevät
`<projects_home>/translator/manual_*_smoke.py`-skriptit ajetaan vain erikseen. Ne eivät
kuulu pytest-kokoelmaan.

These are ownership/reporting categories, not claims about process isolation.
Some automated tests use temporary subprocesses, Git repositories, or files,
but the collection does not start the real Easelect backend or frontend.
Operator-invoked scripts that may start services or write through live APIs live
under `testing/manual/` and have separate dependencies.
