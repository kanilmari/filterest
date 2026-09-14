// filterbar_ai_coding_agent_runner_client_test.go
// Verifies the real Unix-socket transport and immutable operator site identity.
// Connects a fake local runner to the production Go adapter without model calls.
// Prevents browser-controlled commands or site routing from entering dispatch.
package dtt_1_row_read

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"testing"
)

func TestCodingAgentUnixSocketClient(t *testing.T) {
	socket := filepath.Join(t.TempDir(), "runner.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Filterest-Site") != "fixture-site" || r.Header.Get("X-Filterest-Actor") != "42" {
			t.Error("wrong trusted headers")
		}
		if r.URL.Path != "/v1/capabilities" {
			t.Error(r.URL.Path)
		}
		json.NewEncoder(w).Encode(codingAgentAvailability{RunnerReady: true})
	})}
	go server.Serve(listener)
	defer server.Close()
	t.Setenv("FILTEREST_CODING_AGENT_SOCKET", socket)
	t.Setenv("FILTEREST_CODING_AGENT_SITE_ID", "fixture-site")
	var result codingAgentAvailability
	status, err := callCodingAgentRunner(context.Background(), "GET", "/v1/capabilities", 42, nil, &result)
	if err != nil || status != 200 || !result.RunnerReady {
		t.Fatalf("%d %v %+v", status, err, result)
	}
	t.Setenv("FILTEREST_CODING_AGENT_SITE_ID", "")
	if _, err = callCodingAgentRunner(context.Background(), "GET", "/v1/capabilities", 42, nil, &result); err == nil {
		t.Fatal("missing identity accepted")
	}
}
