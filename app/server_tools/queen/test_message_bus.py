# test_message_bus.py
# Verifies Queen message delivery selects the correct local Filterest service.
# Bridges embedded Easelect, standalone nested installs, and explicit API targets.
# Exists so portable Queen sessions never fall back to the sibling development port.

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from .message_bus import MessageBus, _load_base_url


_QUEEN_PACKAGE = __package__ or "server_tools.queen"


class MessageBusBaseURLTests(unittest.TestCase):
    def test_nested_standalone_defaults_to_filterest_port(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            installation_root = Path(temp_dir) / "filterest"
            application_root = installation_root / "app"
            application_root.mkdir(parents=True)
            (application_root / "go.mod").write_text(
                "module example.invalid/filterest\n",
                encoding="utf-8",
            )
            (application_root / "VERSION_APP").write_text("9.0.0\n", encoding="utf-8")

            with patch(f"{_QUEEN_PACKAGE}.message_bus.load_project_env", return_value={}):
                self.assertEqual(
                    _load_base_url(installation_root),
                    "https://localhost:8100",
                )

    def test_embedded_easelect_defaults_to_native_development_port(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            easelect_root = Path(temp_dir) / "easelect"
            (easelect_root / ".git").mkdir(parents=True)
            (easelect_root / "VERSION_EASELECT").write_text(
                "9.0.0\n",
                encoding="utf-8",
            )

            with patch(f"{_QUEEN_PACKAGE}.message_bus.load_project_env", return_value={}):
                self.assertEqual(
                    _load_base_url(easelect_root),
                    "https://localhost:8082",
                )

    def test_configured_port_and_constructor_target_remain_explicit(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir) / "filterest"
            project_root.mkdir()
            with patch(
                f"{_QUEEN_PACKAGE}.message_bus.load_project_env",
                return_value={"APP_PORT": "8199"},
            ):
                self.assertEqual(
                    _load_base_url(project_root),
                    "https://localhost:8199",
                )

        bus = MessageBus(base_url="https://filterest.example.test/")
        self.assertEqual(bus.base_url, "https://filterest.example.test")


if __name__ == "__main__":
    unittest.main()
