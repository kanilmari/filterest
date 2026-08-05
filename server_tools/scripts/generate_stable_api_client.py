#!/usr/bin/env python3
# generate_stable_api_client.py
# Generates a standalone typed frontend client for the current stable API subset.
# Bridges the checked-in route manifest, stable route inventory, and generated Go contract mirror.
# Exists to give #784 a safe standalone client artifact without touching the live endpoint router.

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = PROJECT_ROOT / "frontend/generated/backend_route_manifest.json"
INVENTORY_PATH = PROJECT_ROOT / "frontend/core_components/endpoints/stable_api_inventory.js"
OUTPUT_JS_PATH = PROJECT_ROOT / "frontend/generated/stable_api_client.js"
OUTPUT_DTS_PATH = PROJECT_ROOT / "frontend/generated/stable_api_client.d.ts"

EXPECTED_ROUTE_NAMES = [
    "fetchAuthModes",
    "fetchUserPermissions",
    "fkCacheTriggers",
    "fkCacheRefresh",
]

FUNCTION_NAME_BY_ROUTE = {
    "fetchAuthModes": "fetchAuthModes",
    "fetchUserPermissions": "fetchUserPermissions",
    "fkCacheTriggers": "fetchFKCacheTriggers",
    "fkCacheRefresh": "refreshFKCacheTrigger",
}

CSRF_TOKEN_PATH = "/api/csrf-token"


@dataclass(frozen=True)
class RouteSpec:
    route_name: str
    handler_name: str
    request_shape: str
    response_shape: str
    path: str
    method: str
    method_source: str | None

    @property
    def export_name(self) -> str:
        return FUNCTION_NAME_BY_ROUTE[self.route_name]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a standalone typed client for the current stable API subset."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if generated output differs from checked-in files.",
    )
    return parser.parse_args()


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def extract_inventory_route_specs() -> list[tuple[str, str, str, str]]:
    text = INVENTORY_PATH.read_text(encoding="utf-8")
    pattern = re.compile(
        r"\{\s*"
        r"routeName:\s*'(?P<route_name>[^']+)'\s*,\s*"
        r"handlerName:\s*'(?P<handler_name>[^']+)'\s*,\s*"
        r"requestShape:\s*'(?P<request_shape>[^']+)'\s*,\s*"
        r"responseShape:\s*'(?P<response_shape>[^']+)'\s*,",
        re.S,
    )
    matches = pattern.findall(text)
    if not matches:
        raise ValueError(f"Could not find typed stable route specs in {INVENTORY_PATH}")
    return matches


def build_route_specs() -> list[RouteSpec]:
    manifest = load_manifest()
    manifest_by_handler = {
        route["handler_name"]: route
        for route in manifest["routes"]
    }
    inventory_specs = extract_inventory_route_specs()

    found_route_names: list[str] = []
    specs: list[RouteSpec] = []

    for route_name, handler_name, request_shape, response_shape in inventory_specs:
        if route_name not in EXPECTED_ROUTE_NAMES:
            continue

        route_manifest = manifest_by_handler.get(handler_name)
        if not route_manifest:
            raise ValueError(f"Missing backend manifest entry for handler {handler_name}")

        methods = route_manifest.get("methods") or []
        if len(methods) != 1:
            raise ValueError(
                f"Stable client route {route_name} expected exactly one method, got {methods!r}"
            )

        specs.append(
            RouteSpec(
                route_name=route_name,
                handler_name=handler_name,
                request_shape=request_shape,
                response_shape=response_shape,
                path=route_manifest["path_pattern"],
                method=methods[0],
                method_source=route_manifest.get("method_source"),
            )
        )
        found_route_names.append(route_name)

    missing_route_names = [route_name for route_name in EXPECTED_ROUTE_NAMES if route_name not in found_route_names]
    if missing_route_names:
        raise ValueError(
            "Missing typed stable routes in inventory: " + ", ".join(missing_route_names)
        )

    return specs


def build_js(specs: list[RouteSpec]) -> str:
    route_specs_json = json.dumps(
        {
            spec.route_name: {
                "route_name": spec.route_name,
                "handler_name": spec.handler_name,
                "request_shape": spec.request_shape,
                "response_shape": spec.response_shape,
                "path": spec.path,
                "method": spec.method,
                "method_source": spec.method_source,
                "export_name": spec.export_name,
            }
            for spec in specs
        },
        indent=4,
        sort_keys=True,
    )

    lines = [
        "// stable_api_client.js",
        "// Generated standalone typed client for the current typed stable API subset.",
        "// Bridges the checked-in route manifest, stable route inventory, and generated Go contract mirror.",
        "// Exists as a safe #784 starter artifact without touching the live endpoint router.",
        "// Code generated by server_tools/scripts/generate_stable_api_client.py. DO NOT EDIT.",
        "",
        "const STABLE_API_CLIENT_ROUTE_SPECS = Object.freeze(",
        route_specs_json,
        ");",
        "",
        "export { STABLE_API_CLIENT_ROUTE_SPECS };",
        "",
        "export function createStableApiClient({",
        "    baseUrl = '',",
        "    fetchImpl = globalThis.fetch,",
        "    requestAdapter = null,",
        "    transport = null,",
        f"    csrfTokenUrl = '{CSRF_TOKEN_PATH}',",
        "} = {}) {",
        "    const resolvedFetch = resolveFetchImpl(fetchImpl);",
        "    const resolvedRequestAdapter = requestAdapter || transport || null;",
        "    let csrfTokenPromise = null;",
        "",
        "    async function ensureCsrfToken() {",
        "        if (!csrfTokenPromise) {",
        "            csrfTokenPromise = fetchJson(resolvedFetch, resolveUrl(baseUrl, csrfTokenUrl), {",
        "                method: 'GET',",
        "                credentials: 'include',",
        "            })",
        "                .then((responseData) => responseData?.csrf_token || null)",
        "                .catch(() => null);",
        "        }",
        "",
        "        return csrfTokenPromise;",
        "    }",
        "",
        "    async function invokeRoute(routeSpec, { method = 'GET', body = null, needsCsrf = false } = {}) {",
        "        if (resolvedRequestAdapter) {",
        "            return resolvedRequestAdapter({",
        "                routeSpec,",
        "                routeName: routeSpec.route_name,",
        "                method,",
        "                path: routeSpec.path,",
        "                body,",
        "                needsCsrf,",
        "                baseUrl,",
        "                csrfTokenUrl,",
        "            });",
        "        }",
        "",
        "        return requestJson(routeSpec.path, {",
        "            method,",
        "            body,",
        "            needsCsrf,",
        "        });",
        "    }",
        "",
        "    async function requestJson(path, { method = 'GET', body = null, needsCsrf = false } = {}) {",
        "        const headers = {",
        "            Accept: 'application/json',",
        "        };",
        "        const requestOptions = {",
        "            method,",
        "            credentials: 'include',",
        "            headers,",
        "        };",
        "",
        "        if (body !== null) {",
        "            headers['Content-Type'] = 'application/json';",
        "            requestOptions.body = JSON.stringify(body);",
        "        }",
        "",
        "        if (needsCsrf) {",
        "            const csrfToken = await ensureCsrfToken();",
        "            if (csrfToken) {",
        "                headers['X-CSRF-Token'] = csrfToken;",
        "            }",
        "        }",
        "",
        "        const response = await resolvedFetch(resolveUrl(baseUrl, path), requestOptions);",
        "        if (!response.ok) {",
        "            throw await buildHttpError(response, path, method);",
        "        }",
        "",
        "        return parseJsonResponse(response);",
        "    }",
        "",
        "    return Object.freeze({",
    ]

    for spec in specs:
        export_name = spec.export_name
        if spec.method == "GET":
            lines.append(f"        async {export_name}() {{")
        else:
            lines.append(f"        async {export_name}(request) {{")
        if spec.method == "GET":
            lines.append(f"            return invokeRoute(STABLE_API_CLIENT_ROUTE_SPECS.{spec.route_name}, {{")
            lines.append("                method: 'GET',")
            lines.append("            });")
        else:
            lines.append(f"            return invokeRoute(STABLE_API_CLIENT_ROUTE_SPECS.{spec.route_name}, {{")
            lines.append(f"                method: '{spec.method}',")
            lines.append("                body: request,")
            lines.append("                needsCsrf: true,")
            lines.append("            });")
        lines.append("        },")

    lines.extend([
        "    });",
        "}",
        "",
        "export const stableApiClient = createStableApiClient();",
        "",
    ])

    for spec in specs:
        export_name = spec.export_name
        if spec.method == "GET":
            lines.append(f"export function {export_name}() {{")
            lines.append(f"    return stableApiClient.{export_name}();")
            lines.append("}")
        else:
            lines.append(f"export function {export_name}(request) {{")
            lines.append(f"    return stableApiClient.{export_name}(request);")
            lines.append("}")
        lines.append("")

    lines.extend([
        "function resolveFetchImpl(fetchImpl) {",
        "    const resolved = fetchImpl || globalThis.fetch;",
        "    if (typeof resolved !== 'function') {",
        "        throw new Error('fetch is not available; provide fetchImpl to createStableApiClient');",
        "    }",
        "    return resolved.bind(globalThis);",
        "}",
        "",
        "function resolveUrl(baseUrl, path) {",
        "    const trimmedBaseUrl = String(baseUrl || '').replace(/\\/+$/, '');",
        "    if (!trimmedBaseUrl) {",
        "        return path;",
        "    }",
        "    return `${trimmedBaseUrl}${path}`;",
        "}",
        "",
        "async function fetchJson(fetchImpl, url, options) {",
        "    const response = await fetchImpl(url, options);",
        "    if (!response.ok) {",
        "        throw await buildHttpError(response, url, options?.method || 'GET');",
        "    }",
        "    return parseJsonResponse(response);",
        "}",
        "",
        "async function parseJsonResponse(response) {",
        "    const text = await response.text();",
        "    if (!text) {",
        "        return null;",
        "    }",
        "    return JSON.parse(text);",
        "}",
        "",
        "async function buildHttpError(response, url, method) {",
        "    const bodyText = await response.text().catch(() => '');",
        "    const message = `HTTP ${response.status} for ${method} ${url}${bodyText ? `: ${bodyText}` : ''}`;",
        "    const error = new Error(message);",
        "    error.status = response.status;",
        "    error.statusText = response.statusText;",
        "    error.url = url;",
        "    return error;",
        "}",
    ])

    return "\n".join(lines).rstrip() + "\n"


def build_dts(specs: list[RouteSpec]) -> str:
    lines = [
        "// stable_api_client.d.ts",
        "// Generated standalone typed client declarations for the current typed stable API subset.",
        "// Bridges the generated JS client and the allowlisted Go contract mirror.",
        "// Code generated by server_tools/scripts/generate_stable_api_client.py. DO NOT EDIT.",
        "",
        "import type {",
    ]

    type_names = sorted({
        "AuthModesResponse",
        "UserPermissionsResponse",
        "FKCacheTriggersResponse",
        "FKCacheRefreshRequest",
        "FKCacheRefreshResponse",
    })
    lines.extend([f"    {type_name}," for type_name in type_names])
    lines.extend([
        "} from './go_contract_types';",
        "",
        "export interface StableApiClientRouteSpec {",
        "    route_name: string;",
        "    handler_name: string;",
        "    request_shape: string;",
        "    response_shape: string;",
        "    path: string;",
        "    method: string;",
        "    method_source: string | null;",
        "    export_name: string;",
        "}",
        "",
        "export interface StableApiClientRequestContext {",
        "    routeSpec: StableApiClientRouteSpec;",
        "    routeName: string;",
        "    method: string;",
        "    path: string;",
        "    body: unknown;",
        "    needsCsrf: boolean;",
        "    baseUrl: string;",
        "    csrfTokenUrl: string;",
        "}",
        "",
        "export type StableApiClientRequestAdapter = (request: StableApiClientRequestContext) => unknown | Promise<unknown>;",
        "",
        "export interface StableApiClientOptions {",
        "    baseUrl?: string;",
        "    fetchImpl?: typeof fetch;",
        "    csrfTokenUrl?: string;",
        "    requestAdapter?: StableApiClientRequestAdapter;",
        "    transport?: StableApiClientRequestAdapter;",
        "}",
        "",
        "export interface StableApiClient {",
    ])

    for spec in specs:
        if spec.method == "GET":
            response_type = spec.response_shape
            lines.append(f"    {spec.export_name}(): Promise<{response_type}>;")
        else:
            request_type = spec.request_shape
            response_type = spec.response_shape
            lines.append(f"    {spec.export_name}(request: {request_type}): Promise<{response_type}>;")

    lines.extend([
        "}",
        "",
        "export declare const STABLE_API_CLIENT_ROUTE_SPECS: Readonly<Record<string, {",
        "    route_name: string;",
        "    handler_name: string;",
        "    request_shape: string;",
        "    response_shape: string;",
        "    path: string;",
        "    method: string;",
        "    method_source: string | null;",
        "    export_name: string;",
        "}>>;",
        "",
        "export declare function createStableApiClient(options?: StableApiClientOptions): StableApiClient;",
        "export declare const stableApiClient: StableApiClient;",
    ])

    for spec in specs:
        if spec.method == "GET":
            lines.append(f"export declare function {spec.export_name}(): Promise<{spec.response_shape}>;")
        else:
            lines.append(f"export declare function {spec.export_name}(request: {spec.request_shape}): Promise<{spec.response_shape}>;")

    return "\n".join(lines).rstrip() + "\n"


def write_output(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def main() -> int:
    args = parse_args()
    specs = build_route_specs()
    js_output = build_js(specs)
    dts_output = build_dts(specs)

    if args.check:
        current_js = OUTPUT_JS_PATH.read_text(encoding="utf-8") if OUTPUT_JS_PATH.exists() else ""
        current_dts = OUTPUT_DTS_PATH.read_text(encoding="utf-8") if OUTPUT_DTS_PATH.exists() else ""
        if current_js != js_output or current_dts != dts_output:
            print("stable api client output is out of date", file=sys.stderr)
            return 1
        print("stable api client output is up to date")
        return 0

    write_output(OUTPUT_JS_PATH, js_output)
    write_output(OUTPUT_DTS_PATH, dts_output)
    print(f"Wrote {OUTPUT_JS_PATH.relative_to(PROJECT_ROOT)}")
    print(f"Wrote {OUTPUT_DTS_PATH.relative_to(PROJECT_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
