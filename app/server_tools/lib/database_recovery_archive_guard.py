"""database_recovery_archive_guard.py: pre-creation checks for authenticated dumps.

Inspect pg_restore's listing and nonexecuting schema render before scratch exists.
The installation's own packet key is the boundary; SQL checks are tripwires only.
Never include stored bodies, expressions or argument values in refusal messages.
"""
from __future__ import annotations

import json
import re

if __package__:
    from .database_recovery_packet_io import RecoveryError, safe_diagnostic
else:
    from database_recovery_packet_io import RecoveryError, safe_diagnostic


# public_bootstrap/schema.sql + db_init/01_init_extensions.sh + migrations/*.sql;
# plpgsql is PostgreSQL's default template0 extension. The bootstrap parity test
# deliberately requires review here whenever installation extension creation changes.
ALLOWED_EXTENSIONS = frozenset({"plpgsql", "vector", "postgis", "uuid-ossp", "pg_trgm"})
RESTORE_SCOPE_FLAGS = ("--no-tablespaces", "--no-publications", "--no-subscriptions", "--no-security-labels")
GLOBAL_KINDS = ("ROLE", "ROLE GRANT", "USER", "GROUP", "TABLESPACE")
IDENTIFIER = re.compile(r'"(?:[^"\x00]|"")+"|[A-Za-z_\u0080-\uffff][\w$]*')
ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")

# Tripwire, NOT a security boundary: dynamic SQL can construct all these words.
# One case-insensitive search per relevant definition, never a keyword-by-keyword pass.
TRIPWIRE = re.compile(
    r'\b(?:PROGRAM|lo_import|lo_export|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_file_write|'
    r'ALTER\s+(?:SYSTEM|ROLE)|CREATE\s+ROLE|DROP\s+ROLE|SET\s+ROLE|'
    r'SET\s+SESSION\s+AUTHORIZATION|pg_terminate_backend|dblink)\b', re.I)

# pg_restore emits canonical SQL. Keep quoted bodies atomic so their semicolons,
# LANGUAGE clauses and forged TOC comments cannot become statement boundaries.
LEXEME = re.compile(
    r'--[^\n]*|/\*|(?P<tag>\$(?:[A-Za-z_][\w]*)?\$).*?(?P=tag)|'
    r"[eE]'(?:[^'\\]|\\.|'')*'|'(?:[^']|'')*'|"
    r'"(?:[^"]|"")*"|[A-Za-z_\u0080-\uffff][\w$]*|\s+|.', re.S)
COMMENT_MARK = re.compile(r'/\*|\*/')


def exact_identity(tokens, offset=0, *, qualified=False):
    """Read SQL identifiers, never whitespace-delimited pg_restore tags.

    Quoting preserves case and doubled quotes; PostgreSQL folds ASCII letters
    in unquoted identifiers. Qualified names are used only for diagnostics.
    """
    names = []
    while True:
        if offset >= len(tokens) or not IDENTIFIER.fullmatch(tokens[offset]):
            raise RecoveryError("Ambiguous archive schema identity; restore-check refused before creation")
        token = tokens[offset]
        names.append(token[1:-1].replace('""', '"') if token.startswith('"') else token.translate(ASCII_LOWER))
        offset += 1
        if not qualified or tokens[offset:offset + 1] != ["."]:
            return ".".join(names), offset
        offset += 1


def refuse(kind, name, reason):
    # Only object identity enters diagnostics (then the caller's key/credential
    # redactor); JSON quoting removes newlines/control characters from names.
    label = json.dumps(safe_diagnostic(name)[:180], ensure_ascii=True)
    raise RecoveryError(f"Archive {kind} {label}: {reason}; restore-check refused before creation")


def inspect_entry(descriptor):
    """Classify TOC kinds only; their unquoted identities are deliberately opaque."""
    # PostgreSQL src/bin/pg_dump/pg_dump.c: dumpEventTrigger omits namespace,
    # uses evtinfo->dobj.name as tag and evtinfo->evtowner as owner. Refuse the
    # kind without splitting those raw fields. ROLE/ROLE GRANT/USER/GROUP and
    # TABLESPACE are pg_dumpall SQL globals, not pg_dump TOC entries; these
    # defensive deny labels have no supported namespace/tag/owner layout.
    for kind in ("EVENT TRIGGER", *GLOBAL_KINDS):
        if descriptor == kind or descriptor.startswith(kind + " "):
            # Refuse the entire kind regardless of tag/owner ambiguity; do not
            # claim an identity that cannot be recovered from this listing.
            refuse(kind, "(unresolved TOC identity)", "event triggers and role/tablespace globals are unsupported")
    for kind in ("EXTENSION", "PROCEDURAL LANGUAGE"):
        if descriptor == kind or descriptor.startswith(kind + " "):
            return kind, descriptor
    return None


def match_identities(entries, definitions):
    """Bind every guarded TOC tag one-to-one to its canonical CREATE identity.

    PostgreSQL src/bin/pg_dump/pg_backup_archiver.c: PrintTOCSummary prints
    desc, namespace (or '-'), tag and owner WITHOUT SQL quoting, separated by
    spaces. Preserve its final separator even when owner is empty.
    """
    pending = list(entries)
    for kind, name in definitions:
        prefix = f"{kind} - {name} "
        # src/bin/pg_dump/pg_dump.c: dumpExtension sets tag=extinfo->dobj.name,
        # omits namespace and owner: exactly 'EXTENSION - <complete name> '.
        # Do not accept a missing final space, extra token or guessed owner.
        # dumpProcLang also omits namespace, but sets tag=plang->dobj.name and
        # owner=plang->lanowner. Require one owner token after the complete name;
        # whitespace in that owner could instead belong to the tag, so refuse.
        if kind == "EXTENSION":
            matches = [index for index, (entry_kind, descriptor) in enumerate(pending)
                       if entry_kind == kind and descriptor == prefix]
        else:
            matches = [index for index, (entry_kind, descriptor) in enumerate(pending)
                       if entry_kind == kind == "PROCEDURAL LANGUAGE" and descriptor.startswith(prefix)
                       and re.fullmatch(r'\S+', descriptor[len(prefix):])]
        if len(matches) != 1:
            refuse(kind, name, "ambiguous or unmatched TOC/definition identity")
        pending.pop(matches[0])
    if pending:
        refuse(pending[0][0], "(unresolved TOC identity)", "ambiguous or unmatched TOC/definition identity")


def statements(sql):
    """Split a schema render once, respecting SQL strings and nested comments."""
    tokens, start, position, atomic_depth = [], 0, 0, 0
    while position < len(sql):
        match = LEXEME.match(sql, position)
        token = match[0]
        position = match.end()
        if token == "/*":
            depth = 1
            while depth:
                comment = COMMENT_MARK.search(sql, position)
                if comment is None:
                    raise RecoveryError("Incomplete archive schema comment; restore-check refused before creation")
                depth += 1 if comment[0] == "/*" else -1
                position = comment.end()
            continue
        if token.isspace() or token.startswith("--"):
            continue
        if token == "\\":
            # New pg_dump versions frame file output with these psql commands.
            end = sql.find("\n", position)
            end = len(sql) if end < 0 else end
            if tokens or not re.fullmatch(r'(?:un)?restrict\s+\S+', sql[position:end]):
                raise RecoveryError("Unsupported archive schema command; restore-check refused before creation")
            position = start = end
            continue
        if token in ("'", '"') or token == "$" and re.match(r'(?:[A-Za-z_]\w*)?\$', sql[position:]):
            raise RecoveryError("Incomplete archive schema literal; restore-check refused before creation")
        # SQL-standard function bodies use BEGIN ATOMIC rather than AS $$...$$.
        function = any(value.upper() in ("FUNCTION", "PROCEDURE") for value in tokens[:4])
        if function and (token.upper() == "BEGIN" or atomic_depth and token.upper() == "CASE"):
            atomic_depth += 1
        elif atomic_depth and token.upper() == "END":
            atomic_depth -= 1
        if token == ";" and not atomic_depth:
            yield tokens, sql[start:position]
            tokens, start = [], position
        else:
            tokens.append(token)
    if tokens:
        raise RecoveryError("Incomplete archive schema statement; restore-check refused before creation")


def inspect_definitions(content, entries=None):
    """Inspect definitions only: never execute SQL or scan COPY payload values."""
    identities = []
    for tokens, definition in statements(content.decode("utf-8")):
        words = [token.upper() for token in tokens]
        if not words or words[0] not in ("CREATE", "ALTER", "DROP"):
            continue
        offset = 1
        if words[offset:offset + 2] == ["OR", "REPLACE"]:
            offset += 2
        if words[offset:offset + 1] == ["TRUSTED"]:
            offset += 1
        if words[offset:offset + 1] == ["PROCEDURAL"]:
            offset += 1
        if words[offset:offset + 1] in (["UNIQUE"], ["UNLOGGED"]):
            offset += 1
        if offset >= len(words):
            raise RecoveryError("Incomplete archive schema definition; restore-check refused before creation")
        kind = words[offset]
        identity = offset + 1
        if kind == "EVENT" and words[identity:identity + 1] == ["TRIGGER"]:
            kind, identity = "EVENT TRIGGER", identity + 1
        if kind not in (*GLOBAL_KINDS, "EVENT TRIGGER", "EXTENSION", "LANGUAGE",
                        "FUNCTION", "PROCEDURE", "TABLE", "DOMAIN", "INDEX"):
            continue
        if words[identity:identity + 1] == ["ONLY"]:
            identity += 1
        if words[identity:identity + 3] == ["IF", "NOT", "EXISTS"]:
            identity += 3
        name, end = exact_identity(tokens, identity, qualified=kind not in ("EXTENSION", "LANGUAGE"))
        if kind in ("EXTENSION", "LANGUAGE"):
            kind = "PROCEDURAL LANGUAGE" if kind == "LANGUAGE" else kind
            # No ownership/trust inference from names or TOC prefixes. Only the
            # default language and the installation's exact extensions qualify.
            allowed = name in ALLOWED_EXTENSIONS if kind == "EXTENSION" else name == "plpgsql"
            if not allowed:
                refuse(kind, name, "extension/language is outside the installation allowlist")
            if tokens[end:end + 1] == ["."]:
                refuse(kind, name, "ambiguous archive schema identity")
            if words[0] == "CREATE":
                identities.append((kind, name))
            continue
        if kind in GLOBAL_KINDS or kind == "EVENT TRIGGER":
            refuse(kind, name, "event triggers and role/tablespace globals are unsupported")
        if kind in ("FUNCTION", "PROCEDURE"):
            depth = 0
            for index in range(end, len(tokens) - 1):
                word = words[index]
                if word == "(":
                    depth += 1
                elif word == ")":
                    depth -= 1
                elif not depth and word == "BEGIN" and words[index + 1] == "ATOMIC":
                    break  # SQL-standard body; LANGUAGE there is not a clause.
                elif not depth and word == "LANGUAGE" and exact_identity(tokens, index + 1)[0] in ("c", "internal"):
                    # pg_dump omits extension-owned members: allowed extensions
                    # recreate their native functions via CREATE EXTENSION. A dumped
                    # standalone function (even DEPENDS ON EXTENSION) proves no such ownership.
                    refuse(kind, name, "native-code function has no allowed-extension ownership")
        elif kind not in ("TABLE", "DOMAIN", "INDEX"):
            continue
        elif kind != "INDEX" and not any(word in ("CHECK", "CONSTRAINT", "GENERATED") for word in words):
            continue
        if TRIPWIRE.search(definition):
            refuse(kind, name, "stored-code tripwire matched (dynamic SQL can bypass this tripwire)")
    if entries is not None:
        match_identities(entries, identities)
