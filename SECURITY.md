# Security

Please do not report security vulnerabilities in public issues.

Report suspected security vulnerabilities through the official current private disclosure channel:

`support@filterest.fi`

Normal reproducible bugs, setup problems, documentation corrections, and
focused product feedback may also be sent to that address. Public issue
discussions, if enabled for a published repository, are not a vulnerability
disclosure channel.

GitHub Security Advisories may be added later after the public repository
exists and the project owner has enabled that workflow.

## What To Include

- Affected version or commit.
- Clear reproduction steps.
- Impact summary.
- Whether credentials, private data, authentication, authorization, file upload,
  SSRF, SQL injection, XSS, CSRF, or path traversal may be involved.
- Any proof-of-concept code kept minimal and non-destructive.

## What Not To Include

- Real user data.
- Active secrets or tokens.
- Public exploit details before maintainers have had time to respond.
- Vulnerability details in public issue threads.
- Instructions that require direct database writes outside supported
  application APIs.

## Security Expectations

- Never commit credential files or `.env` values.
- Never commit Google service account JSON keys or equivalent cloud credentials.
- Use example domains such as `example.com` or `.invalid` for sample identities.
- Keep public seed data synthetic or intentionally public.
- Treat the public repository as redistributable: every file should be safe to
  clone, fork, archive, and inspect.

## Existing Administrator Recovery

Filterest 8.40.4 and later include an interactive recovery command for an
existing active administrator. It is an operator-only container command, not a
public web endpoint and not a direct database-editing workflow.

Before changing credentials, take and verify a deployment backup that covers
the database and both active and deleted media. Then inspect the exact target
container without changing credentials:

```bash
docker exec -it <app-container> /app/filterest-admin-recovery --dry-run
```

The preflight prints the database, site, current project, eligible existing
administrators, their current verification methods, and their authentication
generations. When those values identify the intended deployment, run the same
command without `--dry-run`. The command accepts a new password and optional
fixed PIN only through the protected terminal, lets the operator explicitly
choose the post-recovery verification method, and requires the printed target
identity to be typed back exactly.

Recovery does not create users, grant administrator access, change group
memberships, reset application tables, or remove media. A successful recovery
atomically records a secret-free audit entry, removes pending verification
challenges, and invalidates earlier sessions for that administrator.
