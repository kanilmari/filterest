#!/usr/bin/env python3
"""
test_migrate_http_error.py

Unit tests for migrate_http_error.py, focusing on the parenthesis-aware
split_go_arguments() function and the transform_line() function.
Tests edge cases: nested parens, string literals with commas, multi-call lines.

Run from project root:
    python3 -m pytest server_tools/agent_tools/test_migrate_http_error.py -v
"""

import pytest
from migrate_http_error import split_go_arguments, find_http_error_call, transform_line, add_httpresponse_import


# ==========================================
# split_go_arguments tests
# ==========================================

class TestSplitGoArguments:
    """Tests for parenthesis-aware Go argument splitter."""

    def test_simple_three_args(self):
        result = split_go_arguments('w, "error", http.StatusBadRequest')
        assert result == ['w', '"error"', 'http.StatusBadRequest']

    def test_fmt_sprintf_with_comma_in_string(self):
        """fmt.Sprintf with a comma inside the format string should not split."""
        result = split_go_arguments('w, fmt.Sprintf("failed: %s, %v", name, err), http.StatusInternalServerError')
        assert result == [
            'w',
            'fmt.Sprintf("failed: %s, %v", name, err)',
            'http.StatusInternalServerError',
        ]

    def test_nested_parentheses(self):
        """Deeply nested parentheses should track depth correctly."""
        result = split_go_arguments('w, fmt.Sprintf("x(%s)", fn(a, b)), 500')
        assert result == ['w', 'fmt.Sprintf("x(%s)", fn(a, b))', '500']

    def test_backtick_string(self):
        """Go raw string literals (backtick) should preserve commas."""
        result = split_go_arguments('w, `hello, world`, 400')
        assert result == ['w', '`hello, world`', '400']

    def test_escaped_quote_in_string(self):
        """Escaped quotes inside string literals should not break parsing."""
        result = split_go_arguments(r'w, "say \"hi, there\"", 400')
        assert result == ['w', r'"say \"hi, there\""', '400']

    def test_single_arg(self):
        result = split_go_arguments('w')
        assert result == ['w']

    def test_empty_string(self):
        result = split_go_arguments('')
        assert result == []

    def test_whitespace_trimming(self):
        result = split_go_arguments('  w ,  "msg"  ,  500  ')
        assert result == ['w', '"msg"', '500']

    def test_brackets_and_braces(self):
        """Square brackets and curly braces should be tracked for depth."""
        result = split_go_arguments('w, map[string]string{"a,b": "c,d"}, 500')
        assert result == ['w', 'map[string]string{"a,b": "c,d"}', '500']

    def test_concatenated_string_with_plus(self):
        result = split_go_arguments('w, "part1" + "part2, extra", 404')
        assert result == ['w', '"part1" + "part2, extra"', '404']

    def test_multiple_nested_function_calls(self):
        result = split_go_arguments('w, fmt.Sprintf("%s: %s", getKey(ctx), getValue(ctx, opts)), http.StatusNotFound')
        assert result == [
            'w',
            'fmt.Sprintf("%s: %s", getKey(ctx), getValue(ctx, opts))',
            'http.StatusNotFound',
        ]


# ==========================================
# find_http_error_call tests
# ==========================================

class TestFindHttpErrorCall:
    """Tests for locating http.Error() calls in a line."""

    def test_simple_call(self):
        line = '\thttp.Error(w, "bad request", http.StatusBadRequest)'
        result = find_http_error_call(line)
        assert result is not None
        start, end, args = result
        assert args == ['w', '"bad request"', 'http.StatusBadRequest']

    def test_commented_out_line(self):
        """Commented-out http.Error calls should be skipped."""
        line = '\t// http.Error(w, "old", 500)'
        result = find_http_error_call(line)
        assert result is None

    def test_wrong_arg_count(self):
        """Calls with != 3 args should return None."""
        line = '\thttp.Error(w, "msg")'
        result = find_http_error_call(line)
        assert result is None

    def test_nested_sprintf(self):
        line = '\thttp.Error(w, fmt.Sprintf("err: %v", err), http.StatusInternalServerError)'
        result = find_http_error_call(line)
        assert result is not None
        _, _, args = result
        assert args[1] == 'fmt.Sprintf("err: %v", err)'

    def test_start_offset(self):
        """Should find calls starting from a given offset."""
        line = 'x := 1; http.Error(w, "msg", 500)'
        result = find_http_error_call(line, start=5)
        assert result is not None

    def test_no_match(self):
        line = '\tfmt.Println("hello")'
        result = find_http_error_call(line)
        assert result is None


# ==========================================
# transform_line tests
# ==========================================

class TestTransformLine:
    """Tests for full line transformation from http.Error → httpresponse.RespondWithError."""

    def test_simple_transform(self):
        line = '\thttp.Error(w, "bad request", http.StatusBadRequest)\n'
        new_line, changed = transform_line(line)
        assert changed is True
        assert new_line == '\thttpresponse.RespondWithError(w, http.StatusBadRequest, "bad request")\n'

    def test_args_reordered_correctly(self):
        """Verify status and message args are swapped (http.Error has msg,status; RespondWithError has status,msg)."""
        line = '\thttp.Error(w, "not found", http.StatusNotFound)\n'
        new_line, _ = transform_line(line)
        assert 'httpresponse.RespondWithError(w, http.StatusNotFound, "not found")' in new_line

    def test_sprintf_preserved(self):
        line = '\thttp.Error(w, fmt.Sprintf("failed %v", err), http.StatusInternalServerError)\n'
        new_line, changed = transform_line(line)
        assert changed is True
        assert 'httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed %v", err))' in new_line

    def test_commented_line_unchanged(self):
        line = '\t// http.Error(w, "old", 500)\n'
        new_line, changed = transform_line(line)
        assert changed is False
        assert new_line == line

    def test_no_http_error_unchanged(self):
        line = '\tfmt.Println("hello")\n'
        new_line, changed = transform_line(line)
        assert changed is False
        assert new_line == line

    def test_multiple_calls_on_one_line(self):
        """Edge case: two http.Error calls on one line (unlikely but should work)."""
        line = 'if x { http.Error(w, "a", 400) } else { http.Error(w, "b", 500) }\n'
        new_line, changed = transform_line(line)
        assert changed is True
        assert 'httpresponse.RespondWithError(w, 400, "a")' in new_line
        assert 'httpresponse.RespondWithError(w, 500, "b")' in new_line

    def test_indentation_preserved(self):
        line = '        http.Error(w, "err", 500)\n'
        new_line, _ = transform_line(line)
        assert new_line.startswith('        httpresponse.RespondWithError')

    def test_numeric_status_code(self):
        line = '\thttp.Error(w, "err", 500)\n'
        new_line, changed = transform_line(line)
        assert changed is True
        assert 'httpresponse.RespondWithError(w, 500, "err")' in new_line


# ==========================================
# add_httpresponse_import tests
# ==========================================

class TestAddHttpresponseImport:
    """Tests for import injection logic."""

    def test_already_imported_noop(self):
        content = '''import (\n\t"net/http"\n\t"easelect/backend/core_components/httpresponse"\n)\n'''
        result = add_httpresponse_import(content)
        assert result == content

    def test_adds_after_net_http(self):
        content = 'import (\n\t"net/http"\n)\n'
        result = add_httpresponse_import(content)
        assert '"easelect/backend/core_components/httpresponse"' in result
        # Verify it comes after net/http
        http_pos = result.index('"net/http"')
        httpresponse_pos = result.index('"easelect/backend/core_components/httpresponse"')
        assert httpresponse_pos > http_pos

    def test_single_line_import(self):
        content = 'package main\n\nimport "net/http"\n\nfunc main() {}\n'
        result = add_httpresponse_import(content)
        assert 'import "easelect/backend/core_components/httpresponse"' in result

    def test_grouped_import_without_net_http(self):
        content = 'import (\n\t"fmt"\n)\n'
        result = add_httpresponse_import(content)
        assert '"easelect/backend/core_components/httpresponse"' in result
