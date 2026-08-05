#!/usr/bin/env python3
# easelect_api_client.py
# Shared HTTP API client for Easelect developer and agent tooling.
# Bridges root CLI wrappers, future MCP tools, and the native dev backend API.
# Exists so data changes go through app validation instead of direct SQL writes.

import http.cookiejar
import json
import os
from pathlib import Path
import ssl
import sys
import uuid
import urllib.error
import urllib.parse
import urllib.request


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from server_tools.lib.easelect_private_paths import resolve_easelect_private_paths


DEFAULT_BASE_URL = "https://localhost:8082"


class EaselectAPIError(RuntimeError):
    """Raised when the Easelect developer API returns an error response."""


def load_env_file(filepath):
    env = {}
    try:
        with open(filepath, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return env


def load_project_env(project_root=PROJECT_ROOT):
    private_paths = resolve_easelect_private_paths(Path(project_root))
    env = {}
    env.update(load_env_file(private_paths.runtime_env_file))
    env.update(load_env_file(private_paths.development_env_file))
    return env


class EaselectAPIClient:
    def __init__(
        self,
        *,
        project_root=PROJECT_ROOT,
        base_url=None,
        username=None,
        password=None,
        otp_code=None,
    ):
        self.project_root = project_root
        self.project_env = load_project_env(project_root)
        self.base_url = (
            base_url
            or os.environ.get("EASELECT_API_BASE_URL")
            or os.environ.get("DB_TASK_BASE_URL")
            or DEFAULT_BASE_URL
        ).rstrip("/")
        self.username = (
            username
            or os.environ.get("EASELECT_API_USERNAME")
            or self.project_env.get("DEV_USERNAME")
            or ""
        ).strip()
        self.password = (
            password
            or os.environ.get("EASELECT_API_PASSWORD")
            or self.project_env.get("DEV_PASSWORD")
            or ""
        ).strip()
        self.otp_code = (
            otp_code
            or os.environ.get("EASELECT_API_OTP_CODE")
            or self.project_env.get("LOGIN_OTP_CODE")
        )
        self._authenticated = False
        self.cookie_jar = http.cookiejar.CookieJar()
        self._csrf_token = None
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookie_jar),
            urllib.request.HTTPSHandler(context=self._ssl_context()),
        )

    @staticmethod
    def _ssl_context():
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context

    def _url(self, path, query=None):
        if not path.startswith("/"):
            path = "/" + path
        url = self.base_url + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        return url

    def request(self, method, path, *, data=None, query=None, csrf=False, expect_json=True):
        body = None
        headers = {"Accept": "application/json"}
        if data is not None:
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if csrf:
            headers["X-CSRF-Token"] = self.fetch_csrf_token(force=False)

        request = urllib.request.Request(
            self._url(path, query=query),
            data=body,
            headers=headers,
            method=method.upper(),
        )
        try:
            with self._opener.open(request, timeout=30) as response:
                response_body = response.read().decode("utf-8")
                return self._parse_response_body(response_body, expect_json=expect_json)
        except urllib.error.HTTPError as err:
            error_body = err.read().decode("utf-8", errors="replace")
            raise EaselectAPIError(
                f"{method.upper()} {path} failed: HTTP {err.code}: {error_body}"
            ) from err
        except urllib.error.URLError as err:
            raise EaselectAPIError(f"{method.upper()} {path} failed: {err}") from err

    def request_multipart(self, method, path, *, fields=None, query=None, csrf=False):
        """Send multipart form fields between agent tools and file-capable app APIs."""
        boundary = f"----easelect-agent-{uuid.uuid4().hex}"
        body = self._encode_multipart_fields(fields or {}, boundary)
        headers = {
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        }
        if csrf:
            headers["X-CSRF-Token"] = self.fetch_csrf_token(force=False)

        request = urllib.request.Request(
            self._url(path, query=query),
            data=body,
            headers=headers,
            method=method.upper(),
        )
        try:
            with self._opener.open(request, timeout=30) as response:
                response_body = response.read().decode("utf-8")
                return self._parse_response_body(response_body, expect_json=True)
        except urllib.error.HTTPError as err:
            error_body = err.read().decode("utf-8", errors="replace")
            raise EaselectAPIError(
                f"{method.upper()} {path} failed: HTTP {err.code}: {error_body}"
            ) from err
        except urllib.error.URLError as err:
            raise EaselectAPIError(f"{method.upper()} {path} failed: {err}") from err

    @staticmethod
    def _parse_response_body(response_body, *, expect_json=True):
        """Parse HTTP response text between app handlers and Python tool results."""
        if not response_body:
            return {}
        if not expect_json:
            return {"text": response_body}
        try:
            return json.loads(response_body)
        except json.JSONDecodeError as err:
            raise EaselectAPIError(f"API response was not JSON: {response_body}") from err

    @staticmethod
    def _encode_multipart_fields(fields, boundary):
        """Encode simple multipart fields between JSON row data and form APIs."""
        parts = []
        for name, value in fields.items():
            parts.append(f"--{boundary}\r\n".encode("utf-8"))
            parts.append(
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8")
            )
            parts.append(str(value).encode("utf-8"))
            parts.append(b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode("utf-8"))
        return b"".join(parts)

    def fetch_csrf_token(self, *, force=False):
        if self._csrf_token and not force:
            return self._csrf_token
        data = self.request("GET", "/api/csrf-token")
        token = str(data.get("csrf_token") or "").strip()
        if not token:
            raise EaselectAPIError("CSRF token response did not include csrf_token")
        self._csrf_token = token
        return token

    def login(self):
        if self._authenticated:
            return {"authenticated": True, "cached": True}
        if not self.username or not self.password:
            raise EaselectAPIError(
                "login credentials are missing; set DEV_USERNAME/DEV_PASSWORD "
                "in the resolved environment or EASELECT_API_USERNAME/"
                "EASELECT_API_PASSWORD in the process environment"
            )
        csrf_token = self.fetch_csrf_token(force=True)
        first = self.request("POST", "/api/login", data={
            "username": self.username,
            "password": self.password,
            "fingerprint": "easelect-agent-tools",
            "csrf_token": csrf_token,
        })
        if first.get("authenticated") is True:
            self._authenticated = True
            self.fetch_csrf_token(force=True)
            return first
        if first.get("otp_required") is True:
            if not self.otp_code:
                raise EaselectAPIError(
                    "login requires OTP but LOGIN_OTP_CODE/EASELECT_API_OTP_CODE is missing"
                )
            second = self.request("POST", "/api/login", data={
                "username": self.username,
                "password": self.password,
                "fingerprint": "easelect-agent-tools",
                "csrf_token": csrf_token,
                "otp_code": self.otp_code,
            })
            if second.get("authenticated") is not True:
                raise EaselectAPIError(f"OTP login did not authenticate: {second}")
            self._authenticated = True
            self.fetch_csrf_token(force=True)
            return second
        raise EaselectAPIError(f"login did not authenticate: {first}")

    def get_lang_key(self, lang_key):
        return self.request(
            "GET",
            "/api/get-lang-key-translations",
            query={"lang_key": lang_key},
        )

    def upsert_lang_key(self, update, *, dry_run=False):
        lang_key = str(update.get("lang_key") or update.get("key") or "").strip()
        if not lang_key:
            raise EaselectAPIError("lang_key is required for every update")

        before = self.get_lang_key(lang_key)
        next_values = {
            "lang_key": lang_key,
            "fi": before.get("fi", ""),
            "en": before.get("en", ""),
            "ch": before.get("ch", ""),
            "usage_explanation": before.get("usage_explanation", ""),
        }
        for field in ("fi", "en", "ch", "yue", "usage_explanation"):
            if field in update and update[field] is not None:
                next_values[field] = str(update[field])

        if dry_run:
            after = dict(next_values)
        else:
            self.request("POST", "/api/update-lang-key", data=next_values, csrf=True)
            after = self.get_lang_key(lang_key)

        return {
            "lang_key": lang_key,
            "dry_run": dry_run,
            "before": before,
            "after": after,
            "changed": any(
                before.get(field, "") != after.get(field, "")
                for field in ("fi", "en", "ch", "yue", "usage_explanation")
            ),
        }

    def upsert_lang_keys_many(self, updates, *, dry_run=False):
        self.login()
        return [self.upsert_lang_key(update, dry_run=dry_run) for update in updates]

    def list_datasets(self):
        """Read dataset names between MCP/CLI callers and the dataset-name API."""
        self.login()
        return self.request("GET", "/api/dataset-names")

    def get_dataset_columns(self, dataset_name):
        """Read column metadata between a dataset name and the dataset-columns API."""
        self.login()
        encoded_name = urllib.parse.quote(dataset_name, safe="")
        return self.request("GET", f"/api/dataset-columns/{encoded_name}")

    def get_dataset_rows(
        self,
        dataset_name,
        *,
        offset=0,
        sort_column=None,
        sort_order=None,
        filters=None,
        row_count=None,
        include_card_support=False,
        include_map_support=False,
    ):
        """Read row pages between MCP query arguments and the get-results API."""
        self.login()
        query = {
            "dataset": dataset_name,
            "offset": int(offset or 0),
        }
        if sort_column:
            query["sort_column"] = sort_column
        if sort_order:
            query["sort_order"] = sort_order
        if row_count is not None:
            query["row_count"] = row_count
        if include_card_support:
            query["include_card_support"] = "true"
        if include_map_support:
            query["include_map_support"] = "true"
        if isinstance(filters, dict):
            query.update({key: value for key, value in filters.items() if value is not None})
        return self.request("GET", "/api/get-results", query=query)

    def create_dataset(self, request_data):
        """Create a dataset between MCP payloads and the create_dataset API."""
        self.login()
        return self.request(
            "POST",
            "/api/create_dataset",
            data=request_data,
            csrf=True,
            expect_json=False,
        )

    def modify_columns(self, request_data):
        """Modify columns between MCP payloads and the modify-columns API."""
        self.login()
        return self.request("POST", "/api/modify-columns", data=request_data, csrf=True)

    def drop_dataset(self, dataset_name):
        """Drop a dataset between a confirmed MCP call and the drop-dataset API."""
        self.login()
        return self.request(
            "POST",
            "/api/drop-dataset",
            data={"dataset_name": dataset_name},
            csrf=True,
        )

    def add_row(self, dataset_name, row_data):
        """Create one row between MCP row data and the add-row multipart API."""
        self.login()
        return self.request_multipart(
            "POST",
            "/api/add-row-multipart",
            query={"dataset": dataset_name},
            fields={"jsonPayload": json.dumps(row_data, ensure_ascii=False)},
            csrf=True,
        )

    def update_row(self, dataset_name, row_id, updates):
        """Update one row between MCP update data and the update-row API."""
        if isinstance(updates, dict):
            updates = [
                {"column": key, "value": value}
                for key, value in updates.items()
            ]
        self.login()
        return self.request(
            "POST",
            "/api/update-row",
            query={"dataset": dataset_name},
            data={
                "id": int(row_id),
                "updates": updates,
            },
            csrf=True,
        )

    def delete_rows(self, dataset_name, ids):
        """Delete rows between confirmed MCP ids and the delete-rows API."""
        self.login()
        return self.request(
            "POST",
            "/api/delete-rows",
            query={"dataset": dataset_name},
            data={"ids": [int(row_id) for row_id in ids]},
            csrf=True,
        )
