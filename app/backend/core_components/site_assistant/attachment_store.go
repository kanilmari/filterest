// attachment_store.go
// Keeps the images an administrator attaches to a site assistant question.
// Bridges the chat's upload request and the assistant job the runner executes.
// Exists so the engine reads a real file it may open, without the browser ever
// naming a path on this machine.
package site_assistant

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// An attachment lives only as long as the question it belongs to, and each
// administrator may keep a small number of them waiting at a time.
const (
	AttachmentLifetime     = 45 * time.Minute
	MaxAttachmentBytes     = 8 << 20
	MaxAttachmentsPerActor = 4
	AttachmentTokenPrefix  = "fsi1_"
)

// acceptedAttachmentTypes are the image kinds the engine can actually open.
var acceptedAttachmentTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// ErrAttachmentUnsupported reports content that is not one of those images.
var ErrAttachmentUnsupported = errors.New("attachment is not a supported image")

// ErrAttachmentTooMany reports an administrator holding the maximum already.
var ErrAttachmentTooMany = errors.New("too many attachments are already waiting")

// Attachment is one stored image. Path stays on this machine; the browser only
// ever learns the token.
type Attachment struct {
	Token     string
	Name      string
	Path      string
	Actor     int
	ExpiresAt time.Time
}

// AttachmentStore holds the waiting attachments of every administrator.
type AttachmentStore struct {
	mutex       sync.Mutex
	attachments map[string]Attachment
	directory   string
	newToken    func() (string, error)
	now         func() time.Time
}

// DefaultAttachments is the store the running application uses.
var DefaultAttachments = NewAttachmentStore()

// NewAttachmentStore builds an empty store with the process defaults.
func NewAttachmentStore() *AttachmentStore {
	return &AttachmentStore{
		attachments: map[string]Attachment{},
		newToken:    newAttachmentToken,
		now:         time.Now,
	}
}

// Accept stores one image for the asking administrator and returns its token.
// The caller has already read the bytes, so the size limit is checked here too.
func (store *AttachmentStore) Accept(actor int, name string, data []byte) (Attachment, error) {
	if actor <= 1 {
		return Attachment{}, errors.New("an administrator is required")
	}
	if len(data) == 0 || len(data) > MaxAttachmentBytes {
		return Attachment{}, ErrAttachmentUnsupported
	}
	// The declared name is never trusted; the kind is read from the content.
	extension, ok := acceptedAttachmentTypes[detectedImageType(data)]
	if !ok {
		return Attachment{}, ErrAttachmentUnsupported
	}

	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.removeExpiredLocked()
	if store.countForActorLocked(actor) >= MaxAttachmentsPerActor {
		return Attachment{}, ErrAttachmentTooMany
	}
	directory, err := store.directoryLocked()
	if err != nil {
		return Attachment{}, err
	}
	token, err := store.newToken()
	if err != nil {
		return Attachment{}, err
	}
	path := filepath.Join(directory, strings.TrimPrefix(token, AttachmentTokenPrefix)+extension)
	// The runner service may read as another account, so the file is readable
	// but writable only by the application.
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return Attachment{}, err
	}
	attachment := Attachment{
		Token:     token,
		Name:      safeAttachmentName(name, extension),
		Path:      path,
		Actor:     actor,
		ExpiresAt: store.now().Add(AttachmentLifetime),
	}
	store.attachments[token] = attachment
	return attachment, nil
}

// Resolve returns the stored path of one attachment of this administrator.
func (store *AttachmentStore) Resolve(actor int, token string) (Attachment, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.removeExpiredLocked()
	attachment, ok := store.attachments[strings.TrimSpace(token)]
	if !ok || attachment.Actor != actor {
		return Attachment{}, fmt.Errorf("attachment %q is not waiting", token)
	}
	return attachment, nil
}

// Release forgets one attachment and removes its file. A job releases what it
// has copied into its own workspace.
func (store *AttachmentStore) Release(token string) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	if attachment, ok := store.attachments[strings.TrimSpace(token)]; ok {
		_ = os.Remove(attachment.Path)
		delete(store.attachments, attachment.Token)
	}
}

// Waiting reports how many attachments this administrator holds.
func (store *AttachmentStore) Waiting(actor int) int {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.removeExpiredLocked()
	return store.countForActorLocked(actor)
}

func (store *AttachmentStore) countForActorLocked(actor int) int {
	count := 0
	for _, attachment := range store.attachments {
		if attachment.Actor == actor {
			count++
		}
	}
	return count
}

func (store *AttachmentStore) removeExpiredLocked() {
	now := store.now()
	for token, attachment := range store.attachments {
		if now.After(attachment.ExpiresAt) {
			_ = os.Remove(attachment.Path)
			delete(store.attachments, token)
		}
	}
}

// directoryLocked resolves where attachments are written. An operator-shared
// directory lets the separate runner account read them; without one the
// application's own private directory is used, which suits local development
// where the runner is the same account.
func (store *AttachmentStore) directoryLocked() (string, error) {
	if store.directory != "" {
		return store.directory, nil
	}
	if shared := strings.TrimSpace(os.Getenv("FILTEREST_CODING_AGENT_UPLOAD_DIR")); shared != "" {
		if !filepath.IsAbs(shared) {
			return "", errors.New("the shared attachment directory must be an absolute path")
		}
		if err := os.MkdirAll(shared, 0o755); err != nil {
			return "", err
		}
		store.directory = shared
		return store.directory, nil
	}
	directory, err := os.MkdirTemp("", "filterest-site-assistant-attachments-")
	if err != nil {
		return "", err
	}
	store.directory = directory
	return store.directory, nil
}

// newAttachmentToken names one attachment unguessably, and the prefix makes a
// leaked value recognizable.
func newAttachmentToken() (string, error) {
	secret := make([]byte, 24)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("generate attachment token: %w", err)
	}
	return AttachmentTokenPrefix + base64.RawURLEncoding.EncodeToString(secret), nil
}

// detectedImageType reads the kind from the content itself.
func detectedImageType(data []byte) string {
	detected := http.DetectContentType(data)
	if index := strings.Index(detected, ";"); index != -1 {
		detected = detected[:index]
	}
	return strings.ToLower(strings.TrimSpace(detected))
}

// safeAttachmentName keeps a readable name for the chat without letting the
// browser's text reach the filesystem.
func safeAttachmentName(name, extension string) string {
	base := filepath.Base(strings.TrimSpace(name))
	base = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '-', r == '_', r == '.', r == ' ':
			return r
		default:
			return -1
		}
	}, base)
	base = strings.TrimSpace(base)
	if base == "" || base == "." || base == ".." {
		return "image" + extension
	}
	if len(base) > 80 {
		base = base[:80]
	}
	return base
}
