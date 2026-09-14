# Filterest 9.3.9

Database version: 9.7.15 (unchanged).

- Fresh dataset pages use their configured default view from the common read metadata, including readers without the administrator navigation tree. The renderer and view selector apply the existing default-view permission exception to that same dataset default. Permitted explicit and saved view selections keep their existing precedence.
- The administrator Coding agent selector waits for the server capability response instead of hiding prematurely from a cached route list. Failed or unauthorized capability requests keep the control unavailable. Feature policy and runner readiness remain separate.
- The optional external Coding agent runner cleans up its Unix socket when stopped and verifies a leftover socket before restarting. The example service preserves the socket directory across service restarts so existing container mounts can remain attached.

Coding agent access remains administrator-only. Enabling the feature does not install or authenticate an external runner. Production runner provisioning, credential setup and an actual completed model-backed job require separate verification; this release does not claim those steps have succeeded.

No database migration is introduced by this release.
