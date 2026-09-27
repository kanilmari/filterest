// auth_notice_marker_contract_test.go
// Holds this file's notice markers to the shared list the browser reads too.
// Between the markers this package writes into the login page's address and the
// browser code that turns one of them back into a sentence a person can read.
// Exists because the two sides agree by spelling alone: rename a marker here and
// the browser stops recognising it, showing a login page that explains nothing,
// with nothing failing in between. The shared file is what fails instead.
package session_expiry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type authNoticeMarkerContract struct {
	Parameter string `json:"parameter"`
	Notices   []struct {
		Marker    string   `json:"marker"`
		LangKey   string   `json:"langKey"`
		WrittenBy []string `json:"writtenBy"`
	} `json:"notices"`
}

func loadAuthNoticeMarkerContract(t *testing.T) authNoticeMarkerContract {
	t.Helper()
	path := filepath.Join("..", "..", "..", "testing", "shared_contracts", "auth_session_notice_markers.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", path, err)
	}
	var contract authNoticeMarkerContract
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("Unmarshal(%s) error = %v", path, err)
	}
	if contract.Parameter == "" || len(contract.Notices) == 0 {
		t.Fatalf("the shared notice contract is empty; the two sides would go unchecked")
	}
	return contract
}

func TestTheServersNoticeMarkersAreTheSharedOnes(t *testing.T) {
	contract := loadAuthNoticeMarkerContract(t)

	if AuthNoticeParameter != contract.Parameter {
		t.Errorf("this package writes the notice as %q, the shared contract says %q",
			AuthNoticeParameter, contract.Parameter)
	}

	// Only the markers this server actually writes are checked here. One of them,
	// the other-tab notice, is written by the browser alone and has no constant in
	// this package; the shared file records which side writes which.
	written := map[string]string{
		"session-ended":         SessionEndedNotice,
		"sign-out-not-recorded": SignOutNotRecordedNotice,
	}

	for _, notice := range contract.Notices {
		writesItHere := false
		for _, side := range notice.WrittenBy {
			if side == "backend" {
				writesItHere = true
			}
		}
		constant, named := written[notice.Marker]
		if writesItHere != named {
			t.Errorf("the shared contract says the server writes %q = %v, but this test names it = %v; one of the two is out of date",
				notice.Marker, writesItHere, named)
			continue
		}
		if named && constant != notice.Marker {
			t.Errorf("this package spells the notice %q, the shared contract spells it %q",
				constant, notice.Marker)
		}
	}
}
