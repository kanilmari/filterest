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
