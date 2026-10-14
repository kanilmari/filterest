#!/usr/bin/env python3
"""upload_directory.py
Refuse upload roots whose spelling changes between the web writer and runner.
Connect ctl, runner configuration and attachment reads to one lexical path rule.
Keep accepted paths unchanged; filesystem containment and no-follow opens remain separate.
"""

import sys


# Go strings.TrimSpace's Unicode whitespace, mirrored from attachment_store.go.
# Python's default strip also removes four extra control characters.
BOUNDARY_SPACE = "\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"


def validate_upload_directory(value, field="upload_dir"):
    """Accept only unchanged absolute POSIX paths, matching the Go attachment store."""
    if (not isinstance(value, str) or not value.startswith("/") or "\0" in value
            or value.strip(BOUNDARY_SPACE) != value
            or (value != "/" and any(part in ("", ".", "..") for part in value[1:].split("/")))):
        raise ValueError(field + " must be a canonical absolute path: no boundary whitespace, "
                         "repeated or trailing slashes, . or .. segments, or NUL bytes")
    return value


if __name__ == "__main__":
    try:
        validate_upload_directory(sys.argv[1], "FILTEREST_CODING_AGENT_UPLOAD_DIR")
    except ValueError as error:
        sys.exit("error: " + str(error))
