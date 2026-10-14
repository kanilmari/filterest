"""dotenv_reader.py
Read one ctl setting using the backend's godotenv v1.5.1 value rules.
Between protected native env files and the coding-agent launcher, without evaluation.
Keep quotes, whitespace, comments and interpolation consistent with the web loader.
"""
import re
import sys
from pathlib import Path
from unicodedata import category


# Match github.com/joho/godotenv v1.5.1/parser.go, pinned in app/go.mod.
# The library expands earlier file assignments, never the process environment.
SPACE = "\t\v\f\r \x85\xa0"
STATEMENT_SPACE = SPACE + "\n\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"
VARIABLE = re.compile(r"(\\)?(\$)(\()?\{?([A-Z0-9_]+)?\}?")


def expand_variables(value, values):
    def replace(match):
        if match[1] == "\\" or match[2] == "(":
            return match[0][1:]
        return values.get(match[4], "") if match[4] else match[0]
    return VARIABLE.sub(replace, value)


def read_dotenv(content):
    """Decode the complete file; malformed settings must not become defaults."""
    remaining = content.replace("\r\n", "\n")
    values = {}
    while remaining:
        remaining = remaining.lstrip(STATEMENT_SPACE)
        if not remaining:
            break
        if remaining.startswith("#"):
            _, _, remaining = remaining.partition("\n")
            continue
        if remaining.startswith("export") and remaining[6:7] and remaining[6:7] in SPACE:
            remaining = remaining[6:].lstrip(SPACE)
        offset = 0
        key = ""
        for index, character in enumerate(remaining):
            if character in SPACE:
                continue
            if character in "=:":
                key, offset = remaining[:index].rstrip(STATEMENT_SPACE), index + 1
                break
            # godotenv validates the UTF-8 bytes of names as individual runes.
            if any(chr(byte) not in SPACE + "_." and category(chr(byte))[0] not in "LN"
                   for byte in character.encode("utf-8")):
                raise ValueError("unexpected character in variable name")
        remaining = remaining[offset:].lstrip(SPACE)
        quote = remaining[:1]
        if quote in ("'", '"'):
            end = next((index for index in range(1, len(remaining))
                        if remaining[index] == quote and remaining[index - 1] != "\\"), None)
            if end is None:
                raise ValueError("unterminated quoted value")
            value = remaining[:end].strip(quote)
            remaining = remaining[end + 1:]
            if quote == '"':
                value = re.sub(r"\\.", lambda match: {r"\n": "\n", r"\r": "\r"}.get(match[0], match[0]), value)
                value = re.sub(r"\\([^$])", r"\1", value)
                value = expand_variables(value, values)
        else:
            end = next((index for index, character in enumerate(remaining)
                        if character in "\r\n"), len(remaining))
            value, remaining = remaining[:end], remaining[end:]
            for index in range(len(value) - 1, 0, -1):
                if value[index] == "#" and value[index - 1] in SPACE:
                    value = value[:index]
                    break
            value = expand_variables(value.strip(SPACE), values)
        values[key] = value
    return values


def main():
    try:
        # Disable newline translation: godotenv normalizes only CRLF pairs.
        with Path(sys.argv[1]).open(encoding="utf-8", newline="") as settings:
            values = read_dotenv(settings.read())
        value = values.get(sys.argv[2], "")
        # Bash cannot carry NUL bytes. Refuse an upload root before command
        # substitution silently discards them; dotenv decoding stays unchanged.
        if sys.argv[2] == "FILTEREST_CODING_AGENT_UPLOAD_DIR" and "\0" in value:
            raise ValueError("FILTEREST_CODING_AGENT_UPLOAD_DIR must be a canonical absolute path: NUL bytes are not allowed")
        print(value, end="")
    except (OSError, UnicodeError, ValueError) as error:
        # Never include env-file contents (which can contain secrets) in errors.
        reason = str(error) if isinstance(error, ValueError) and not isinstance(error, UnicodeError) else "cannot read file"
        print(f"error: invalid dotenv settings in {sys.argv[1]}: {reason}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
