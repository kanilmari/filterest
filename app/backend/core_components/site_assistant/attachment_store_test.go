// attachment_store_test.go
// Verifies what the chat may attach to a site assistant question.
// Bridges the upload request, the stored file and the job that reads it.
// Uses only local files: no model, credentials or site requests.
package site_assistant

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func pngBytes(t *testing.T) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, 2, 2))
	canvas.Set(0, 0, color.RGBA{R: 200, G: 30, B: 30, A: 255})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, canvas); err != nil {
		t.Fatalf("fixture image: %v", err)
	}
	return buffer.Bytes()
}

func storeInTemp(t *testing.T) *AttachmentStore {
	t.Helper()
	store := NewAttachmentStore()
	store.directory = t.TempDir()
	return store
}

func TestAcceptStoresAnImageOnlyForItsOwnAdministrator(t *testing.T) {
	store := storeInTemp(t)
	attachment, err := store.Accept(40787, "Näyttökuva 2026.PNG", pngBytes(t))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	if !strings.HasPrefix(attachment.Token, AttachmentTokenPrefix) {
		t.Fatalf("token = %q", attachment.Token)
	}
	if !strings.HasSuffix(attachment.Path, ".png") {
		t.Fatalf("path = %q", attachment.Path)
	}
	if _, statErr := os.Stat(attachment.Path); statErr != nil {
		t.Fatalf("stored file: %v", statErr)
	}
	// The name is kept readable but never reaches the filesystem unchanged.
	if attachment.Name != "Nyttkuva 2026.PNG" {
		t.Fatalf("name = %q", attachment.Name)
	}

	if _, err := store.Resolve(40787, attachment.Token); err != nil {
		t.Fatalf("the owner must resolve it: %v", err)
	}
	if _, err := store.Resolve(40788, attachment.Token); err == nil {
		t.Fatal("another administrator must not resolve it")
	}
}

func TestAcceptRefusesContentThatIsNotASupportedImage(t *testing.T) {
	store := storeInTemp(t)
	for name, data := range map[string][]byte{
		"a script":   []byte("<?php echo 1; ?>"),
		"empty":      {},
		"a pdf":      []byte("%PDF-1.7\n%âãÏÓ\n"),
		"oversized":  bytes.Repeat([]byte{0x89}, MaxAttachmentBytes+1),
		"plain text": []byte("this is not an image at all, it is only text"),
	} {
		if _, err := store.Accept(40787, "x.png", data); err == nil {
			t.Fatalf("%s was accepted", name)
		}
	}
	if store.Waiting(40787) != 0 {
		t.Fatal("a refused upload must not be stored")
	}
}

func TestAcceptRequiresAnAdministratorAndBoundsTheWaitingSet(t *testing.T) {
	store := storeInTemp(t)
	if _, err := store.Accept(1, "x.png", pngBytes(t)); err == nil {
		t.Fatal("a guest must not attach images")
	}
	for index := 0; index < MaxAttachmentsPerActor; index++ {
		if _, err := store.Accept(40787, "x.png", pngBytes(t)); err != nil {
			t.Fatalf("accept %d: %v", index, err)
		}
	}
	if _, err := store.Accept(40787, "x.png", pngBytes(t)); err != ErrAttachmentTooMany {
		t.Fatalf("the limit must hold: %v", err)
	}
	// Another administrator keeps their own room.
	if _, err := store.Accept(40788, "x.png", pngBytes(t)); err != nil {
		t.Fatalf("second administrator: %v", err)
	}
}

func TestReleaseAndExpiryRemoveTheStoredFile(t *testing.T) {
	store := storeInTemp(t)
	released, err := store.Accept(40787, "x.png", pngBytes(t))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	store.Release(released.Token)
	if _, statErr := os.Stat(released.Path); !os.IsNotExist(statErr) {
		t.Fatal("a released attachment must leave no file")
	}

	expiring, err := store.Accept(40787, "x.png", pngBytes(t))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	store.now = func() time.Time { return time.Now().Add(AttachmentLifetime + time.Minute) }
	if _, err := store.Resolve(40787, expiring.Token); err == nil {
		t.Fatal("an expired attachment must not resolve")
	}
	if _, statErr := os.Stat(expiring.Path); !os.IsNotExist(statErr) {
		t.Fatal("an expired attachment must leave no file")
	}
}

// Exercise the real writer's path in the real attachment helper. Invalid roots
// must fail before writing, and the reader must also refuse a cleaned pathname.
func TestUploadDirectoryAgreementWithRunner(t *testing.T) {
	cases := []struct {
		name, prefix, suffix string
		refused              bool
	}{
		{"plain", "", "", false},
		{"internal spaces", "", "/chosen uploads", false},
		{"internal newline", "", "/line\nbreak", false},
		{"quoted trailing spaces", "", "  ", true},
		{"trailing newline", "", "\n", true},
		{"unicode trailing space", "", "\u00a0", true},
		{"two leading slashes", "/", "", true},
		{"three leading slashes", "//", "", true},
		{"trailing slash", "", "/", true},
		{"repeated interior slash", "", "//uploads", true},
		{"dot segment", "", "/./uploads", true},
		{"parent segment", "", "/child/../uploads", true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			directory := test.prefix + filepath.Join(t.TempDir(), "uploads") + test.suffix
			t.Setenv("FILTEREST_CODING_AGENT_UPLOAD_DIR", directory)
			store := NewAttachmentStore()
			data := pngBytes(t)
			attachment, err := store.Accept(40787, "x.png", data)
			path := attachment.Path
			if test.refused {
				if err == nil || !strings.Contains(err.Error(), "canonical absolute path") {
					t.Fatalf("noncanonical root was not refused: %v", err)
				}
				if path != "" || store.directory != "" || store.Waiting(40787) != 0 {
					t.Fatal("refusal must not publish a directory or attachment")
				}
				if _, err := os.Stat(filepath.Clean(strings.TrimSpace(directory))); !os.IsNotExist(err) {
					t.Fatalf("refused root created a directory: %v", err)
				}
				// The old writer's generated pathname must never become an
				// accepted attachment by bypassing configuration validation.
				path = filepath.Join(strings.TrimSpace(directory), "probe.png")
			} else {
				if err != nil {
					t.Fatalf("accept: %v", err)
				}
				defer store.Release(attachment.Token)
				if store.directory != directory || filepath.Dir(path) != directory {
					t.Fatalf("writer changed the root: %q -> %q", directory, path)
				}
			}
			request, err := json.Marshal(map[string]any{"root": directory, "path": path, "refused": test.refused})
			if err != nil {
				t.Fatal(err)
			}
			modules, err := filepath.Abs("../../../server_tools/agent_tools/coding_agent")
			if err != nil {
				t.Fatal(err)
			}
			command := exec.Command("python3", "-c", `
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from site_assistant_jobs import store_attached_images
request = json.load(sys.stdin)
workspace = Path(sys.argv[2])
try:
    images = store_attached_images({"images": [{"path": request["path"]}]}, workspace, request["root"])
except ValueError as error:
    assert request["refused"] and "canonical absolute path" in str(error), str(error)
    assert not list(workspace.iterdir()), "refused image left a copy"
else:
    assert not request["refused"], "noncanonical root was accepted"
    sys.stdout.buffer.write(images[0].read_bytes())
`, modules, t.TempDir())
			command.Stdin = bytes.NewReader(request)
			output, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("runner attachment helper: %v: %s", err, output)
			}
			if test.refused {
				if len(output) != 0 {
					t.Fatalf("refused attachment returned data: %q", output)
				}
			} else if !bytes.Equal(output, data) {
				t.Fatal("runner copy differs from the web upload")
			}
		})
	}
}
