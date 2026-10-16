"""Prove component registration, profiles and packaging without shipping a component.
Connect a temporary Go overlay to the actual composition root and conformance test.
Keep fixture routes and files out of both the source tree and generated manifests.
"""

import json
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "app"


def component_overlay(tmp_path, *, profile=True):
    sources = {
        "backend/core_components/router/components.go": '''package router
import canary "easelect/components/registration_fixture/backend"
func registerComponents() { canary.Register() }
''',
        "components/registration_fixture/backend/registration.go": '''package registration_fixture
import (
 "net/http"
 "sync"
 appregistry "easelect/backend/core_components/app_registry"
 "easelect/backend/pipeline"
)
var once sync.Once
func Register() {
 once.Do(func() {
  appregistry.RegisterRoute("/api/registration-fixture", Handler, "registration_fixture.Handler", http.MethodGet)
 })
 PROFILE
}
func Handler(w http.ResponseWriter, r *http.Request) {}
'''.replace("PROFILE", 'pipeline.RegisterRouteProfile("registration_fixture.Handler", pipeline.DefaultProfile)' if profile
           else '_ = pipeline.DefaultProfile'),
        "backend/pipeline/component_registration_fixture_test.go": '''package pipeline_test
import (
 "testing"
 "easelect/backend/core_components/router"
 "easelect/backend/pipeline"
)
func TestFixtureComponentRegistrationAndManifest(t *testing.T) {
 for pass := 0; pass < 2; pass++ {
  router.RegisterRoutes("frontend", "storage")
  count := 0
  for _, route := range router.GetRouteDefinitions() {
   if route.HandlerName == "registration_fixture.Handler" { count++ }
  }
  if count != 1 { t.Fatalf("fixture registrations = %d", count) }
 }
 manifest, err := router.BuildDefaultRouteManifest()
 if err != nil { t.Fatal(err) }
 found := false
 for _, route := range manifest.Routes {
  if route.HandlerName == "registration_fixture.Handler" {
   found = true
   if route.PathPattern != "/api/registration-fixture" || len(route.Scenarios) != 3 {
    t.Fatalf("incomplete manifest fixture: %#v", route)
   }
   for _, scenario := range route.Scenarios {
    if scenario.ProfileName != "default" { t.Fatal(scenario) }
   }
  }
 }
 if !found { t.Fatal("manifest missed fixture") }
 pipeline.ResetRouteProfiles()
}
''',
    }
    overlay = {}
    for index, (relative, source) in enumerate(sources.items()):
        backing = tmp_path / f"overlay_{index}.go"
        backing.write_text(source)
        overlay[str(APP / relative)] = str(backing)
    manifest = tmp_path / "overlay.json"
    manifest.write_text(json.dumps({"Replace": overlay}))
    return manifest


@pytest.mark.parametrize("profile", [True, False], ids=["explicit-profile", "missing-profile-rejected"])
def test_component_registration_reaches_route_profile_conformance(tmp_path, profile):
    overlay = component_overlay(tmp_path, profile=profile)
    result = subprocess.run(
        # vet cannot chdir into an overlay-only directory; normal package tests
        # still run vet. No fixture directory is materialized in shared source.
        ["go", "test", "-vet=off", f"-overlay={overlay}", "./backend/pipeline", "-run",
         "TestRouteProfilesConformance|TestFixtureComponentRegistrationAndManifest", "-count=1", "-v"],
        cwd=APP, text=True, capture_output=True, timeout=180,
    )
    output = result.stdout + result.stderr
    if profile:
        assert result.returncode == 0, output
        assert "PASS: TestFixtureComponentRegistrationAndManifest" in output
        assert "PASS: TestRouteProfilesConformance" in output
    else:
        assert result.returncode != 0, output
        assert "FAIL: TestRouteProfilesConformance" in output
        assert "registration_fixture.Handler" in output


def test_component_docker_stages_keep_frontend_as_sibling():
    dockerfile = (APP / "docker/Dockerfile").read_text()
    stages = dockerfile.split("\nFROM ")
    for marker in ("AS frontend-builder", "AS backend-builder", "WORKDIR /filterest/app"):
        stage = next(part for part in stages if marker in part)
        assert "COPY components/ ./components/" in stage
        assert "components/ ./frontend" not in stage
    handler = (APP / "backend/core_components/router/component_assets_handler.go").read_text()
    assert 'filepath.Join(filepath.Dir(localFrontendDir), "components")' in handler
    assets = (APP / "backend/core_components/frontend_assets/component_assets.go").read_text()
    assert 'openComponentDirectory(component, "frontend")' in assets
