<!-- Commit_Confirmed_Responses.md -->
<!-- Defines finite-write delivery and the read/streaming exceptions. -->
<!-- Connects route methods, transaction completion and response buffering. -->
<!-- Keeps commit failures from exposing uncommitted success to the client. -->
# Commit-confirmed responses

The transaction middleware holds finite responses for unsafe HTTP methods until
the request transaction commits successfully, if one was opened. If no request
transaction was opened, it releases the response after the handler returns.
Commit failure replaces status, body and operation-owned headers
(including Location, cookies and Content-Length) with the existing JSON 500 error.
Headers installed before the transaction middleware remain available to the error.
A request without a configured database pool passes its writer through unchanged.

A failure that happens after the database committed (releasing the request
barrier or the pool admission slot) keeps the committed outcome: the response is
delivered, after-commit hooks run, and only the cleanup failure is logged. The
pool connector and `dbutils.LazyTx` mark such failures as
`dbutils.CommittedCleanupError`. Reporting a saved change as failed would invite
a retry that saves it twice.

Finite response bodies are buffered without a size limit, preserving the existing
buffer's behavior. Large successes are delivered intact after commit; a commit
failure replaces the entire response regardless of its size.

Flush, including `http.ResponseController.Flush`, never releases output that
awaits a commit: while a request transaction is open, or after an explicit
`httpresponse.EnableCommitBuffer`, it is held. With automatic buffering and no
open request transaction there is nothing to confirm, so Flush delivers what was
written so far and later output is forwarded. Pool-only handlers rely on this;
for example, password reset acknowledges the request before its background
delivery starts. Once output has been forwarded this way, or as a stream, the
request transaction can no longer open: `dbutils.RequireTxWithError` returns an
error (and `dbutils.RequireTx` reports no transaction) for the rest of the request,
so nothing written afterwards can be reported as saved before its commit. Such handlers write through a pool and check their own commit.
Hijacking is not available while output is held.

Informational statuses (1xx other than 101) are dropped while output is held.
They are not the final response and do not affect stream forwarding.

GET, HEAD, OPTIONS and TRACE retain forwarding. These POST reads also retain
forwarding and their existing response sizes because the body carries query inputs:

- `/api/check-table-rights` and `/api/check-table-rights-multi`.
- `/api/fetch-dynamic-children` and `/api/comment-counts`.
- `/api/query-table` and `/api/count-lang-embeddings`.
- `/api/geocode-address`.
- `/api/image-source-picker/resolve` and `/api/image-source-picker/file`.
- `/api/app/ai-chat/query` and `/api/dev-ai-translate-single`.

New unsafe routes default to buffering. Before adding a POST read exception in
`middlewares/with_transaction.go`, verify that no branch writes through the request
transaction. "Read" here means no Filterest request-transaction mutation, not the
absence of every side effect: `/api/image-source-picker/file` still reports a
download to its image provider.

Automatic buffering forwards a declared `text/event-stream` or
`application/x-ndjson` response from its first output, provided no request
transaction is open at that moment. A stream cannot be replaced after a failed
commit, so a handler that writes through the request transaction before streaming
stays buffered and commit-confirmed. The existing streaming routes are:

- POST `/api/embedding_stream_handler`: SSE progress/errors while embedding rows;
  its database writes use the pool rather than the request transaction.
- GET `/api/sse/subscribe`: long-lived row-change events and heartbeats.
- GET `/api/get-intelligent-results`: staged text and semantic search results.
- GET `/api/admin/update-notice/stream`: administrator notices, already using
  `AdminNoTxProfile` to omit the request transaction.

Streaming handler code and profiles retain their existing behavior. An explicit
`httpresponse.EnableCommitBuffer` call remains fail-closed even for a streaming
media type: permission changes cannot opt out of commit confirmation by flushing.
Routes that skip transaction middleware keep their existing completion contract;
handlers that own transactions must still check Commit before reporting success.

## Writes outside the request transaction

The commit-before-success guarantee covers writes in the request transaction only.
A route that writes directly through a database pool, opens its own transaction,
or starts background work is outside that guarantee for those writes. Response
buffering does not make those writes part of the request transaction. For example,
PUT `/api/app/ai-chat/conversation` saves through the pool and echoes the entire
conversation. With no request transaction it releases that echo when the handler
returns. If an earlier stage opened a request transaction and its commit fails,
the echo is replaced, but the independently saved conversation remains saved.

The write-route inventory identified these direct pool-written branches. Source
paths below start at `app/backend/core_components/`; mixed-method routes also have
read branches, which this list does not classify as writes.

| Routes | Pool-written operation and source |
| --- | --- |
| PUT `/api/app/ai-chat/conversation` | Conversation upsert: `dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/ai_chat_conversation_handler.go`. |
| POST `/api/comments/create`, DELETE `/api/comments/delete` | Comment insert/delete: `dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/comment_handler.go`. |
| POST `/api/update-tab-order` | Folder tab order: `system_table_tools/system_table_column_metadata.go`. |
| POST `/api/create-folder`, `/api/update-folder`, `/api/update-table-folder`, `/api/delete-folder` | Folder creation, renaming, dataset placement and deletion: `dynamic_table_tools/dtt_table_folders/create_table_folder.go`, `update_table_folders.go`, `delete_table_folder.go`. |
| POST `/api/scan-lang-sources` | Language-source upserts/cleanup: `system_table_tools/lang_key_source_data_scan.go`, `lang_key_source_population.go`. |
| POST `/api/generateTranslations` | Translation/source persistence: `lang/get_ai_translations.go`. |
| POST `/api/fix-translations` | Dataset translation repair outside the `system_config` branch: `lang/fix_table_translations.go`. |
| POST `/api/set-comments`, `/api/create-indexes` | Schema annotations/indexes: `dynamic_table_tools/dtt_crud_workflows/schema_comments_and_indexes_handler.go`. |
| POST `/api/payments/create`, `/api/payments/webhook` | Payment insert/update: `payment_gateway/payments_handlers.go`. |
| DELETE `/api/app/agent-tools/tasks` | Task deletion: `agent_tools/task_handlers.go`. |
| POST/PUT/PATCH `/api/app/agent-tools/task-runs` | Run creation/update: `agent_tools/task_runs.go`. |
| POST/PUT/PATCH/DELETE `/api/app/agent-tools/task-todos` | Todo creation/update/deletion: `agent_tools/agent_task_todos.go`. |
| POST/PUT/PATCH/DELETE `/api/app/agent-tools/task-groups` | Group creation/update/deletion: `agent_tools/task_group_handlers.go`. |
| POST `/api/app/agent-tools/worklines` | Workline creation: `agent_tools/workline_handlers.go`. |
| PUT/PATCH `/api/app/agent-tools/workline-reports` | Report state: `agent_tools/workline_report_handlers.go`. |
| POST/DELETE `/api/app/agent-tools/workline-tasks` | Task linking/unlinking: `agent_tools/workline_handlers.go`. |
| PUT/PATCH `/api/app/agent-tools/handover-reports` | Report state/comments: `agent_tools/handover_report_handlers.go`, `handover_report_reading.go`. |
| POST `/api/request-email-change-otp`, `/api/request-password-change-otp` | Verification-code creation/revocation: `otp/otp.go`. |
| POST `/api/admin/missing-media-check` | Settings and background results: `missing_media_check/missing_media_handler.go`, `missing_media_runner.go`. |
| POST `/api/admin/application-update/reauthentication` | Authentication-attempt reservation through the administrator pool: `application_updates/admission_handler.go`. |
| POST `/api/logout` | Sign-in revocation through the pool: `auth/logout_handler.go`. |
| POST `/api/embedding_stream_handler` | Streaming pool writes: `dynamic_table_tools/ai_features/embedding_stream_handler.go`. |

Separately owned transactions found in that inventory also remain outside the
request guarantee: `/system/automation-account`, `/first-run`,
`/api/register_ndYOyXV0INOK3F`, `/api/sign-out-other-devices`,
`/api/update-profile`, `/api/admin/user-login-name`,
`/api/set-current-project-folder`, and the create/update branches of
`/api/app/agent-tools/tasks`, `/api/app/agent-tools/worklines`,
`/api/app/agent-tools/workline-reports`, `/api/app/agent-tools/handover-reports`.
Verification-code reservation/verification and language-source orphan marking
also own transactions independently. Their handlers/services must check their own
commit before reporting success. This inventory documents the boundaries found;
response buffering alone is not evidence that another route's writes use the
request transaction.

CSV export reports a file path only after the final row-iteration check, the CSV
writer's Flush/Error check (including short writes), fsync and Close complete. It
writes a hidden temporary file beside `tables_data/<table>.csv` and renames it into
place last, so `ImportTableCSV`, which reads that path, sees either the previous or
the new complete file. A failed export returns no path or table, removes its own
temporary file and leaves the previous export untouched; close and cleanup errors
join the first failure. An existing export keeps its permission bits and, on Linux,
its owner, group and POSIX access ACL; an ACL inherited from the directory is
removed when the previous export had none. The replacement stays private (0600)
until its owner and ACL are in place. When one of them cannot be kept (for example
another account's file without the privilege to keep its owner), the export is
refused and the previous file stays. A new export gets 0666 less the umask, as
before. A symlinked export is replaced where the link points; a broken link is
refused rather than replaced. The rename is not
made crash-durable with a directory fsync. The read-only HTTP route keeps forwarding.

## Proofs

- `middlewares/commit_response_test.go` and `commit_response_boundary_test.go`
  cover these cases, with a local SQL driver:
  - finite writes with and without a request transaction;
  - no status line before commit (empty 200, 204, redirect);
  - replacement after a failed commit, a cancelled request, or a panic under
    the per-route recovery stage;
  - committed-with-cleanup-failure delivery;
  - `ResponseController` and hijacking;
  - stream forwarding, and stream holding once a transaction is open;
  - 1xx preludes;
  - flushing without a transaction;
  - the request transaction refused after a stream or a flush;
  - pass-through when no database pool exists;
  - a real HTTP server round trip, including HEAD.
- `middlewares/commit_postgres_test.go`
  (`FILTEREST_TEST_DISPOSABLE_POSTGRES=1`) uses a disposable PostgreSQL
  cluster. A deferred unique constraint accepts the INSERT and rejects
  COMMIT; the client receives 500 and the row is absent. A valid control row
  is delivered and kept.
- `dbutils/commit_outcome_test.go` and
  `runtime_grants/database_phase_connector_test.go` keep a commit's outcome
  when a release fails after it.
- These real handlers are tested:
  - ordinary row update, with a forced commit failure;
  - the POST embedding SSE stream;
  - row-access and chat-conversation responses above one MiB;
  - password reset, whose acknowledgement is still flushed through the
    middleware.
- `dev_tools/export_table_csv_test.go` covers the CSV export:
  - late row, write, short-write, sync, owner, permission, access-rule,
    close, rename and cleanup failures, each leaving the previous export
    byte-identical;
  - permission, owner, group and ACL keeping, including removing an
    inherited directory ACL and installing access rules while the file is
    private;
  - symlinked and broken-link exports;
  - an import-path read during an export;
  - concurrent exports.

The route inventory above was taken from the source and records which files
write outside the request transaction. Line numbers are omitted because they
drift; re-check the named files before relying on a row.
