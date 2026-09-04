#!/usr/bin/env python3
# easelect_api_client.py
# Shared HTTP API client for Filterest and embedded Easelect developer tooling.
# Bridges root CLI wrappers, future MCP tools, and the selected native backend API.
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


CANONICAL_FILTEREST_ROOT = Path(__file__).resolve().parents[2]
if not __package__ and str(CANONICAL_FILTEREST_ROOT) not in sys.path:
    sys.path.insert(0, str(CANONICAL_FILTEREST_ROOT))

try:
    from ..lib.easelect_private_paths import (
        resolve_easelect_private_paths,
        resolve_embedded_project_root,
    )
    from ..lib.filterest_paths import is_private_easelect_source_checkout
except ImportError:
    from server_tools.lib.easelect_private_paths import (
        resolve_easelect_private_paths,
        resolve_embedded_project_root,
    )
    from server_tools.lib.filterest_paths import is_private_easelect_source_checkout


PROJECT_ROOT = str(resolve_embedded_project_root(CANONICAL_FILTEREST_ROOT))
_IS_EMBEDDED_EASELECT_CHECKOUT = is_private_easelect_source_checkout(
    Path(PROJECT_ROOT)
)


LOCAL_NATIVE_PORT = 8082 if _IS_EMBEDDED_EASELECT_CHECKOUT else 8100
DEFAULT_BASE_URL = f"https://localhost:{LOCAL_NATIVE_PORT}"
FILTEREST_API_BASE_URL_ENV = "FILTEREST_API_BASE_URL"
FILTEREST_API_USERNAME_ENV = "FILTEREST_API_USERNAME"
FILTEREST_API_PASSWORD_ENV = "FILTEREST_API_PASSWORD"
FILTEREST_API_OTP_CODE_ENV = "FILTEREST_API_OTP_CODE"
INSECURE_TLS_ENV = "FILTEREST_API_ALLOW_INSECURE_TLS"
LEGACY_INSECURE_TLS_ENV = "EASELECT_API_ALLOW_INSECURE_TLS"


class EaselectAPIError(RuntimeError):
    """Raised when the Easelect developer API returns an error response."""


def _url_origin(url):
    """Return a normalized web origin for redirect-boundary comparison."""

    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port
    except (TypeError, ValueError):
        return None
    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").lower()
    if scheme not in {"http", "https"} or not hostname:
        return None
    if parsed.username is not None or parsed.password is not None:
        return None
    effective_port = port or (443 if scheme == "https" else 80)
    return scheme, hostname, effective_port


def _validate_api_base_url(url):
    """Reject malformed targets and plaintext credential transport off loopback."""

    try:
        parsed = urllib.parse.urlsplit(url)
        _ = parsed.port
    except (TypeError, ValueError) as error:
        raise EaselectAPIError("API base URL is invalid") from error
    hostname = (parsed.hostname or "").lower()
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise EaselectAPIError(
            "API base URL must be an HTTP(S) origin or path without credentials, query, or fragment"
        )
    if parsed.scheme.lower() == "http" and hostname not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        raise EaselectAPIError("remote API targets require HTTPS")
    return str(url).rstrip("/")


class _SameOriginRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Permit API redirects only inside the client-configured origin."""

    def __init__(self, base_url):
        super().__init__()
        self.allowed_origin = _url_origin(base_url)

    def redirect_request(self, request, fp, code, message, headers, new_url):
        resolved_url = urllib.parse.urljoin(request.full_url, new_url)
        if self.allowed_origin is None or _url_origin(resolved_url) != self.allowed_origin:
            raise EaselectAPIError(
                "API redirect outside the configured scheme, host, or port was refused"
            )
        return super().redirect_request(
            request,
            fp,
            code,
            message,
            headers,
            resolved_url,
        )


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


def load_project_env(project_root=PROJECT_ROOT, environment=None):
    """Load only protected project files selected by the structural root."""

    resolved_environment = os.environ if environment is None else environment
    private_paths = resolve_easelect_private_paths(
        Path(project_root),
        resolved_environment,
    )
    env = {}
    env.update(load_env_file(private_paths.runtime_env_file))
    env.update(load_env_file(private_paths.development_env_file))
    return env


def _project_is_private_easelect(project_root):
    return is_private_easelect_source_checkout(Path(project_root).resolve())


def _default_base_url_for_project(project_root):
    port = 8082 if _project_is_private_easelect(project_root) else 8100
    return f"https://localhost:{port}"


def resolve_api_base_url(project_root=PROJECT_ROOT, environment=None):
    """Resolve a Filterest target without inheriting Easelect-only ambient state."""

    resolved_environment = os.environ if environment is None else environment
    filterest_target = str(
        resolved_environment.get(FILTEREST_API_BASE_URL_ENV, "") or ""
    ).strip()
    if filterest_target:
        return filterest_target.rstrip("/")
    if _project_is_private_easelect(project_root):
        legacy_target = str(
            resolved_environment.get("EASELECT_API_BASE_URL", "") or ""
        ).strip()
        if legacy_target:
            return legacy_target.rstrip("/")
    return _default_base_url_for_project(project_root)


class EaselectAPIClient:
    def __init__(
        self,
        *,
        project_root=PROJECT_ROOT,
        base_url=None,
        username=None,
        password=None,
        otp_code=None,
        verification_code_provider=None,
        environment=None,
    ):
        resolved_environment = os.environ if environment is None else environment
        self.project_root = project_root
        self.is_embedded_easelect = _project_is_private_easelect(project_root)
        self.local_native_port = 8082 if self.is_embedded_easelect else 8100
        self.base_url = _validate_api_base_url(str(
            base_url
            or resolve_api_base_url(project_root, resolved_environment)
        ).rstrip("/"))
        self.is_local_native_target = self._is_local_native_base_url(
            self.base_url,
            native_port=self.local_native_port,
        )

        # Protected project files and generic development variables belong only
        # to the exact native loopback service. A caller-selected remote URL
        # must never inherit credentials that were stored for local development.
        self.project_env = (
            load_project_env(project_root, resolved_environment)
            if self.is_local_native_target
            else {}
        )
        legacy_api_username = ""
        legacy_api_password = ""
        legacy_api_otp_code = ""
        legacy_dev_username = ""
        legacy_dev_password = ""
        legacy_dev_otp_code = ""
        if self.is_embedded_easelect:
            legacy_api_username = resolved_environment.get("EASELECT_API_USERNAME") or ""
            legacy_api_password = resolved_environment.get("EASELECT_API_PASSWORD") or ""
            legacy_api_otp_code = resolved_environment.get("EASELECT_API_OTP_CODE") or ""
            if self.is_local_native_target:
                legacy_dev_username = resolved_environment.get("DEV_USERNAME") or ""
                legacy_dev_password = resolved_environment.get("DEV_PASSWORD") or ""
                legacy_dev_otp_code = (
                    resolved_environment.get("DEV_LOGIN_VERIFICATION_CODE")
                    or resolved_environment.get("LOGIN_OTP_CODE")
                    or ""
                )
        self.username = (
            username
            or resolved_environment.get(FILTEREST_API_USERNAME_ENV)
            or legacy_api_username
            or legacy_dev_username
            or self.project_env.get("DEV_USERNAME")
            or ""
        ).strip()
        self.password = (
            password
            or resolved_environment.get(FILTEREST_API_PASSWORD_ENV)
            or legacy_api_password
            or legacy_dev_password
            or self.project_env.get("DEV_PASSWORD")
            or ""
        ).strip()
        self.otp_code = (
            otp_code
            or resolved_environment.get(FILTEREST_API_OTP_CODE_ENV)
            or legacy_api_otp_code
            or legacy_dev_otp_code
            or self.project_env.get("DEV_LOGIN_VERIFICATION_CODE")
            or self.project_env.get("LOGIN_OTP_CODE")
        )
        self.verification_code_provider = verification_code_provider
        self.last_verification_method = None
        self._authenticated = False
        self.cookie_jar = http.cookiejar.CookieJar()
        self._csrf_token = None
        transport_handlers = []
        if self.is_local_native_target:
            # urllib otherwise inherits HTTPS_PROXY from the process. Native
            # administrator credentials must never leave loopback through an
            # ambient or caller-controlled proxy.
            transport_handlers.append(urllib.request.ProxyHandler({}))
        transport_handlers.extend((
            _SameOriginRedirectHandler(self.base_url),
            urllib.request.HTTPCookieProcessor(self.cookie_jar),
            urllib.request.HTTPSHandler(
                context=self._ssl_context(
                    self.base_url,
                    environment=resolved_environment,
                    embedded_easelect=self.is_embedded_easelect,
                    native_port=self.local_native_port,
                )
            ),
        ))
        self._opener = urllib.request.build_opener(*transport_handlers)

    @staticmethod
    def _ssl_context(
        base_url,
        environment=None,
        embedded_easelect=None,
        native_port=None,
    ):
        """Verify remote TLS while allowing the native self-signed dev origin."""
        context = ssl.create_default_context()
        resolved_environment = os.environ if environment is None else environment
        private_source = (
            _IS_EMBEDDED_EASELECT_CHECKOUT
            if embedded_easelect is None
            else embedded_easelect
        )
        if (
            EaselectAPIClient._is_local_native_base_url(
                base_url,
                native_port=native_port,
            )
            or resolved_environment.get(INSECURE_TLS_ENV) == "1"
            or (
                private_source
                and resolved_environment.get(LEGACY_INSECURE_TLS_ENV) == "1"
            )
        ):
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        return context

    @staticmethod
    def _is_local_native_base_url(base_url, native_port=None):
        """Recognize only the exact native loopback origin used for development."""
        try:
            parsed = urllib.parse.urlsplit(base_url)
            port = parsed.port
        except (TypeError, ValueError):
            return False

        return (
            parsed.scheme == "https"
            and parsed.hostname in {"localhost", "127.0.0.1"}
            and port == (LOCAL_NATIVE_PORT if native_port is None else native_port)
            and parsed.username is None
            and parsed.password is None
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
        )

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
            if not self.is_local_native_target:
                raise EaselectAPIError(
                    "remote API targets require credentials supplied explicitly "
                    "as client arguments or FILTEREST_API_USERNAME/"
                    "FILTEREST_API_PASSWORD process variables; protected local "
                    "credentials are never sent to remote targets"
                )
            raise EaselectAPIError(
                "login credentials are missing; set DEV_USERNAME/DEV_PASSWORD "
                "in the resolved protected environment or FILTEREST_API_USERNAME/"
                "FILTEREST_API_PASSWORD in the process environment"
            )
        csrf_token = self.fetch_csrf_token(force=True)
        first = self.request("POST", "/api/login", data={
            "username": self.username,
            "password": self.password,
            "fingerprint": "easelect-agent-tools",
            "csrf_token": csrf_token,
        })
        if first.get("authenticated") is True:
            self.last_verification_method = "none"
            self._authenticated = True
            self.fetch_csrf_token(force=True)
            return first
        if first.get("otp_required") is True:
            self.last_verification_method = str(first.get("verification_method") or "").strip()
            # A visible interactive prompt must win over any stale code loaded
            # from the developer environment. Otherwise a previous OTP can be
            # submitted silently and the human never gets a chance to enter the
            # factor requested by the server.
            verification_code = None
            if callable(self.verification_code_provider):
                verification_code = self.verification_code_provider(first)
            elif self.otp_code:
                verification_code = self.otp_code
            if not verification_code:
                raise EaselectAPIError(
                    "login requires a verification code but no configured code or provider is available"
                )
            second = self.request("POST", "/api/login", data={
                "username": self.username,
                "password": self.password,
                "fingerprint": "easelect-agent-tools",
                "csrf_token": csrf_token,
                "otp_code": verification_code,
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
            "yue": before.get("yue", ""),
            "usage_explanation": before.get("usage_explanation", ""),
        }
        patch_values = {"lang_key": lang_key}
        for field in ("fi", "en", "ch", "yue", "usage_explanation"):
            if field in update and update[field] is not None:
                next_values[field] = str(update[field])
                patch_values[field] = str(update[field])

        if len(patch_values) == 1:
            raise EaselectAPIError(
                f"at least one language-key field is required for {lang_key}"
            )

        if dry_run:
            after = dict(next_values)
            after["exists"] = True
        else:
            self.request("POST", "/api/admin/lang-key", data=patch_values, csrf=True)
            after = self.get_lang_key(lang_key)

            mismatched_fields = [
                field
                for field in ("fi", "en", "ch", "yue", "usage_explanation")
                if str(after.get(field, "")) != str(next_values.get(field, ""))
            ]
            if after.get("exists") is False or mismatched_fields:
                details = ", ".join(mismatched_fields) or "exists"
                raise EaselectAPIError(
                    f"language-key readback mismatch for {lang_key}: {details}"
                )

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

    def get_all_dataset_rows(
        self,
        dataset_name,
        *,
        offset=0,
        sort_column=None,
        sort_order=None,
        filters=None,
        max_pages=1000,
    ):
        """Read every row without misusing get-results row_count as a page size."""
        rows = []
        seen_pages = set()
        current_offset = int(offset or 0)
        for _ in range(int(max_pages)):
            payload = self.get_dataset_rows(
                dataset_name,
                offset=current_offset,
                sort_column=sort_column,
                sort_order=sort_order,
                filters=filters,
            )
            page = payload.get("data", []) if isinstance(payload, dict) else payload
            if not isinstance(page, list):
                raise EaselectAPIError("row response did not contain a data list")
            if not page:
                return rows
            marker = json.dumps(page, sort_keys=True, default=str)
            if marker in seen_pages:
                raise EaselectAPIError("row pagination repeated a previous page")
            seen_pages.add(marker)
            rows.extend(page)
            current_offset += len(page)
        raise EaselectAPIError(f"row export exceeded max_pages={max_pages}")

    def rename_tree_node(self, item_id, item_type, new_name, translations):
        """Rename one folder or dataset through the transactional tree API."""
        self.login()
        return self.request(
            "POST",
            "/api/rename-tree-node",
            data={
                "item_id": int(item_id),
                "item_type": str(item_type),
                "new_name": str(new_name),
                "translations": dict(translations or {}),
            },
            csrf=True,
        )

    def get_auth_modes(self):
        """Read public authentication switches for post-mutation verification."""
        return self.request("GET", "/api/auth-modes")

    def set_registration_enabled(self, enabled):
        """Set and verify the registration flag through ordinary row APIs."""
        def normalized_json_value(row):
            value = row.get("json_value")
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    return None
            return value

        self.login()
        matches = [
            row
            for row in self.get_all_dataset_rows("system_config")
            if row.get("key") == "registration_enabled"
        ]
        if len(matches) > 1:
            raise EaselectAPIError("registration_enabled config row was not unique")
        before = bool(matches[0].get("boolean_value")) if matches else False
        json_value = {"value": bool(enabled)}
        canonical_values = {
            # Generic row APIs accept JSON/JSONB fields as serialized values;
            # PostgreSQL drivers cannot bind a Python mapping directly.
            "json_value": json.dumps(json_value, separators=(",", ":")),
            "boolean_value": bool(enabled),
            # system_config value type 2 is the boolean editor. Keep it
            # canonical even when repairing an older or API-created row.
            "value_type": 2,
        }
        if not matches:
            self.add_row(
                "system_config",
                {
                    "key": "registration_enabled",
                    **canonical_values,
                    "creation_spec": (
                        "Administrator-owned self-registration availability setting."
                    ),
                },
            )
        elif int(matches[0].get("id") or 0) <= 0:
            raise EaselectAPIError("registration_enabled config row had no usable id")
        elif (
            matches[0].get("boolean_value") != bool(enabled)
            or normalized_json_value(matches[0]) != json_value
            or int(matches[0].get("value_type") or 0) != 2
        ):
            self.update_row(
                "system_config",
                int(matches[0]["id"]),
                canonical_values,
            )
        readback = [
            row
            for row in self.get_all_dataset_rows("system_config")
            if row.get("key") == "registration_enabled"
        ]
        if (
            len(readback) != 1
            or normalized_json_value(readback[0]) != json_value
            or (
                readback[0].get("boolean_value") is not None
                and readback[0].get("boolean_value") != bool(enabled)
            )
            or int(readback[0].get("value_type") or 0) != 2
        ):
            raise EaselectAPIError("registration_enabled config row readback did not match")
        auth_modes = self.get_auth_modes()
        if auth_modes.get("registration_enabled") != bool(enabled):
            raise EaselectAPIError("registration_enabled readback did not match")
        return {
            "key": "registration_enabled",
            "before": before,
            "after": bool(enabled),
            "verified": True,
        }

    def list_user_authentication(self):
        """List non-secret user provisioning and sign-in-method state for admins."""
        self.login()
        payload = self.request("GET", "/api/admin/user-authentication")
        users = payload.get("users") if isinstance(payload, dict) else None
        if not isinstance(users, list):
            raise EaselectAPIError("user-authentication response did not contain a users list")
        return users

    def get_symbol_registry_snapshot(self):
        """Read safe symbols and current dataset/field assignments through the admin API."""
        self.login()
        payload = self.request("GET", "/api/admin/symbols")
        if not isinstance(payload, dict):
            raise EaselectAPIError("symbol registry response was not an object")
        for key in ("symbols", "datasets", "fields"):
            if not isinstance(payload.get(key), list):
                raise EaselectAPIError(f"symbol registry response did not contain a {key} list")
        return payload

    def assign_symbol(self, target_type, target_uid, icon_key):
        """Assign one safe key and verify authoritative metadata readback through the admin API."""
        normalized_type = str(target_type or "").strip().lower()
        if normalized_type not in {"dataset", "field"}:
            raise EaselectAPIError("target_type must be dataset or field")
        normalized_uid = int(target_uid)
        if normalized_uid <= 0:
            raise EaselectAPIError("target_uid must be positive")
        normalized_key = str(icon_key or "").strip().lower()
        if not normalized_key:
            raise EaselectAPIError("icon_key is required")

        identity_key = "table_uid" if normalized_type == "dataset" else "column_uid"
        collection_key = "datasets" if normalized_type == "dataset" else "fields"

        def find_assignment(snapshot):
            matches = [
                item
                for item in snapshot[collection_key]
                if int(item.get(identity_key) or 0) == normalized_uid
            ]
            if len(matches) != 1:
                raise EaselectAPIError(
                    f"symbol assignment target {normalized_type} {normalized_uid} was not unique"
                )
            return matches[0]

        before = find_assignment(self.get_symbol_registry_snapshot())
        self.request(
            "POST",
            "/api/admin/symbols",
            data={
                "target_type": normalized_type,
                "target_uid": normalized_uid,
                "icon_key": normalized_key,
            },
            csrf=True,
        )
        after = find_assignment(self.get_symbol_registry_snapshot())
        if str(after.get("icon_key") or "") != normalized_key:
            raise EaselectAPIError("symbol assignment readback did not match")
        return {
            "target_type": normalized_type,
            "target_uid": normalized_uid,
            "before": before,
            "after": after,
            "verified": True,
        }

    def set_user_authentication(self, user_id, verification_method, *, fixed_pin=None):
        """Provision one administrator and set its sign-in method without exposing secrets."""
        method = str(verification_method or "").strip().lower()
        if method not in {"none", "email", "fixed_pin"}:
            raise EaselectAPIError("verification_method must be none, email, or fixed_pin")
        pin = str(fixed_pin or "").strip()
        if method == "fixed_pin" and (not pin.isdigit() or not 4 <= len(pin) <= 8):
            raise EaselectAPIError("fixed_pin must contain 4-8 digits")
        if method != "fixed_pin" and pin:
            raise EaselectAPIError("fixed_pin is allowed only with verification_method=fixed_pin")

        request_data = {
            "user_id": int(user_id),
            "verification_method": method,
        }
        if method == "fixed_pin":
            request_data["fixed_pin"] = pin

        self.login()
        return self.request(
            "POST",
            "/api/admin/user-authentication",
            data=request_data,
            csrf=True,
        )

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

    def set_column_multilingual(self, dataset_name, column_uid, is_multilingual):
        """Set one column's multilingual contract through the canonical admin API."""
        self.login()
        return self.request(
            "POST",
            "/api/admin/column-multilingual",
            data={
                "dataset": str(dataset_name),
                "column_uid": int(column_uid),
                "is_multilingual": bool(is_multilingual),
            },
            csrf=True,
        )

    def set_column_insertable(self, dataset_name, column_uid, insertable):
        """Set one column's new-row form availability through the canonical admin API."""
        self.login()
        return self.request(
            "POST",
            "/api/admin/column-insertable",
            data={
                "dataset": str(dataset_name),
                "column_uid": int(column_uid),
                "insertable": bool(insertable),
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


def authenticated_api_request(method, path, *, data=None, query=None):
    """Make one authenticated JSON API request for standalone CLI helpers."""

    normalized_method = str(method).upper()
    client = EaselectAPIClient()
    client.login()
    return client.request(
        normalized_method,
        path,
        data=data,
        query=query,
        csrf=normalized_method not in {"GET", "HEAD", "OPTIONS"},
    )
