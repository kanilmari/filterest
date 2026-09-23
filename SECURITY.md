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

## Administrator Recovery

Filterest includes one interactive operator command for administrator access. It
is an operator-only container command, not a public web endpoint and not a direct
database-editing workflow. It has two separate modes, and each must be chosen
explicitly:

- **Restore an existing administrator** — the default mode, described below. Use
  this whenever the installation still has a usable administrator account.
- **Create a new administrator** — the `--create-admin` mode, described in
  [Creating An Administrator When None Is Usable](#creating-an-administrator-when-none-is-usable).
  Use this only when no usable administrator account exists, which can happen on
  a restored or rebuilt site.

Neither mode can be reached from the other. The restore mode never creates an
account, and the creation mode never changes an existing account.

## Existing Administrator Recovery

Filterest 8.40.4 and later include an interactive recovery command for an
existing active administrator.

Before changing credentials, take and verify a deployment backup that covers
the database and both active and deleted media. Then inspect the exact target
container without changing credentials:

```bash
docker exec -it <app-container> /app/filterest-admin-recovery --dry-run
```

The preflight prints the database, site, current project, eligible existing
administrators, their current verification methods, and their authentication
generations. The canonical domain is read from the container's protected
`BASE_URL`, printed separately, and used as the first part of the final target
confirmation; it is never inferred from the site's display name. Recovery
fails closed when that public-origin setting is missing or ambiguous. When
those values identify the intended deployment, run the same command without
`--dry-run`. The command accepts a new password and optional
fixed PIN only through the protected terminal, lets the operator explicitly
choose the post-recovery verification method, and requires the printed target
identity to be typed back exactly. That identity is a safety phrase, not a
filesystem path or password; for example,
`filterest.com/Filterest/filterest/filterest:filterest_admin` names the domain,
site, current project, database, and administrator account in that order.

Recovery does not create users, grant administrator access, change group
memberships, reset application tables, or remove media. A successful recovery
atomically records a secret-free audit entry, removes pending verification
challenges, and invalidates earlier sessions for that administrator.

When the command finds no eligible administrator to restore, it says so and
names the creation mode below instead of failing silently.

## Creating An Administrator When None Is Usable

A restored or rebuilt site can end up with no usable administrator account at
all: the account may have been lost with its data, disabled, or removed from the
administrator group. For that case the same command creates one new
administrator account under the same protections. It is the exception, not the
ordinary repair path — when any administrator still exists, restore that account
instead of adding another one.

Take and verify a deployment backup first, exactly as for restore. Then inspect
the target without changing anything:

```bash
docker exec -it <app-container> /app/filterest-admin-recovery --create-admin --dry-run
```

The preflight prints the same database identity readback as restore — the
canonical domain from the container's protected `BASE_URL`, the database, the
database version, the site, the current project and the instance kind and role —
plus the operating-system account and host running the command, and every
administrator the installation already has. Nothing is created in a dry run.

Run the same command without `--dry-run` to create the account. The command then:

1. Refuses to continue on a database older than the supported release, or on a
   target whose database, site name or current project is not identified.
2. Requires the phrase `CREATE ANOTHER ADMINISTRATOR` to be typed **if** the
   installation already has an eligible administrator, and names the restore path
   before asking. With no eligible administrator, it says so and continues.
3. Asks for the new account name and email address in the visible terminal, and
   refuses a name or address that is malformed, or that any existing account
   already holds. The refusal is case-insensitive and changes nothing.
4. Asks for the sign-in verification method: a fixed PIN, email verification when
   delivery and the account address are ready, or password-only behind the same
   explicit warning and confirmation the restore mode uses. New authenticator
   (TOTP) enrollment is not supported by this command.
5. Accepts the password, and a fixed PIN when chosen, only through the protected
   terminal, twice each and never echoed. No secret is accepted as a command
   argument, an environment value or a file, and no secret is printed or logged.
6. Restates the account it is about to create, then requires the same
   domain-qualified target confirmation to be typed back exactly, with the new
   account name as its last part.

The account it creates is the same thing the first-run browser form creates: the
same shared account definition writes the enabled, non-privileged public identity
with administrator access allowed, the `admins` group membership that carries
administrator permissions, and the restricted credentials — in one transaction
with a secret-free audit entry that records the target, the new account, the
operating-system operator and the time. If the one-time first-run browser setup
form was still open, the same transaction closes it, and the command says so.

Creation never updates an existing account, never changes another account's
credentials or group memberships, and never resets application tables or media.
If any check fails, nothing is written.

The command needs the site's own name to be configured, because that name is
part of the target confirmation. A brand-new installation that has never
completed the first-run browser form has no site name yet; complete that form
instead of using this command.
