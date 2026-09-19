// attachment_store_test.go
// Verifies what the chat may attach to a site assistant question.
// Bridges the upload request, the stored file and the job that reads it.
// Uses only local files: no model, credentials or site requests.
package site_assistant

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
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
