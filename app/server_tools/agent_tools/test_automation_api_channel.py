#!/usr/bin/env python3
# test_automation_api_channel.py
# Tests the real urllib processing chain without issuing network requests.
# Bridges shared GET/JSON/multipart transports with the explicit automation channel.
# Exists so bot transport compatibility never relies on forged browser identities.
from __future__ import annotations

from email.message import Message
import io
import unittest
import urllib.request
import urllib.response

from .easelect_api_client import EaselectAPIClient


class RecordingTransport(urllib.request.BaseHandler):
    handler_order = 100

    def __init__(self):
        self.requests = []

    def https_open(self, request):
        self.requests.append(request)
        headers = Message()
        headers["Content-Type"] = "application/json"
        response = urllib.response.addinfourl(
            io.BytesIO(b'{"csrf_token":"fixture","ok":true}'), headers, request.full_url, 200,
        )
        response.msg = "OK"
        return response


class AutomationAPIChannelTest(unittest.TestCase):
    def test_all_real_transport_paths_send_truthful_channel_headers(self):
        client = EaselectAPIClient(
            base_url="https://filterest.example", username="fixture", password="fixture",
            environment={},
        )
        transport = RecordingTransport()
        client._opener.add_handler(transport)
        client.fetch_csrf_token()
        client.request("POST", "/api/fixture", data={"value": 1}, csrf=True)
        client.request_multipart("POST", "/api/fixture", fields={"value": "x"}, csrf=True)
        self.assertEqual(len(transport.requests), 3)
        for request in transport.requests:
            self.assertEqual(request.get_header("User-agent"), "Filterest-Agent-Tools/1.0")
            self.assertEqual(request.get_header("X-filterest-automation"), "1")
            self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertEqual(transport.requests[1].get_header("X-csrf-token"), "fixture")
        self.assertEqual(transport.requests[2].get_header("X-csrf-token"), "fixture")
        self.assertEqual(transport.requests[1].get_header("Content-type"), "application/json")
        self.assertTrue(transport.requests[2].get_header("Content-type").startswith("multipart/form-data;"))


if __name__ == "__main__":
    unittest.main()
