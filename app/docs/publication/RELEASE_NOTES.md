Filterest 9.3.17 makes creating and editing a dataset one form, lets dialogs read cleanly on every screen, and lets AI suggestions search every language. Database compatibility moves from 9.8.0 to 9.8.1; the migrations are additive and existing installations keep their rows.

- Creating a dataset and managing it in the Manage table dialog are one form in two modes, with the same settings and one column table whose header stays in view while the columns scroll. Saving again after a partly failed save repeats nothing, and "No symbol" removes the symbol.
- A new dataset goes to the current project's folder, so it appears in the site's navigation. The notice names the folder, warns when the dataset will not be listed and offers to open it, and the site tabs refresh at once. A new folder is created behind "New folder…".
- Dialogs no longer hide their content under a fixed empty band. Their margins scroll with the content, the title row reaches the edges, forms inside them have no second frame, and no dialog touches the screen edges on a phone. A dropdown inside a dialog opens above it, so its options can be picked.
- Confirmation prompts read in every language instead of showing their language key as words, and the foreign-keys page opens for administrators.
- A failed request shows exactly one notice, in the reader's language, for server errors, an unavailable service, too many requests, other refusals and a lost connection alike. The dataset chat shows the same sentence instead of a technical message.
- AI suggestions search the embeddings of every language, measure closeness per embedding model, and never repeat the dataset's own matches. Searching keeps browsing in every view.
- The embeddings page shows, per dataset, whether it is embedded, rows without or with stale embeddings, languages, the last refresh and whether a row change re-embeds automatically, under the provider and model in use.
- The dataset chat's coding agent is one runner with two named modes: "Code workspace" edits the local checkout on development machines only, and "Site assistant" works through the site's own interface and waits for approval before any change. Codex no longer receives the web server's secrets, and jobs survive server restarts.
- A long link in a card is no longer cut through the middle of its letters.
- Dataset header settings save only the dataset they loaded, so a failed or slow load can no longer overwrite a dataset's texts. The unused project banner is removed; an uploaded banner file stays on disk but is no longer served.
- An installation using Google for AI search no longer risks its key: the embedding request carries the key in a header, so a failed request's error cannot repeat it into the server log or an administrator's browser.
- Every installation has a deletion log, and groups that may read a dataset may also load its filter options.
- Only the application's own database role can create tables, including on databases that began on PostgreSQL 14 or older. A development server no longer lets anyone create datasets, indexes or comments without logging in.
- `./db` and `./api_crud` inspect and maintain an installation from the repository root, the read-only inspection tool is strictly read-only, and `./filterest release verify` checks a checkout before a release.

Existing installations retain their data and settings.

- The production container image builds as Alpine replaces package builds: packages are constrained only by the base image's release branch, which still receives security fixes.
