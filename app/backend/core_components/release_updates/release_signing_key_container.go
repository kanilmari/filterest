// release_signing_key_container.go
// Encrypts offline Ed25519 seeds with the owner's passphrase and exposes public identity.
// Connects terminal-only CLI custody to Argon2id and XChaCha20-Poly1305 containers.
// Keeps mounted USB keys unusable without owner participation, including on WSL drvfs.
package release_updates

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/sys/unix"
	"golang.org/x/text/unicode/norm"
)

const MaxSigningKeyContainerBytes = 4096
const signingKeyContainerFormat = "filterest-release-signing-key"

// All clear metadata, including the nonce and bounded KDF profile, is AEAD AAD.
// Ciphertext holds only the 32-byte Ed25519 seed and the 16-byte authentication tag.
type signingKeyHeaderV1 struct {
	Format      string          `json:"format"`
	Version     int             `json:"version"`
	PublicKey   string          `json:"public_key"`
	Fingerprint string          `json:"fingerprint"`
	KDF         signingKeyKDFV1 `json:"kdf"`
	Cipher      string          `json:"cipher"`
	Nonce       string          `json:"nonce"`
}
type signingKeyKDFV1 struct {
	Name        string `json:"name"`
	Version     int    `json:"version"`
	Salt        string `json:"salt"`
	MemoryKiB   uint32 `json:"memory_kib"`
	Iterations  uint32 `json:"iterations"`
	Parallelism uint8  `json:"parallelism"`
}
type signingKeyContainerV1 struct {
	Header     signingKeyHeaderV1 `json:"header"`
	Ciphertext string             `json:"ciphertext"`
}

// GenerateSigningKeyFile creates a fresh encrypted container and its public output
// exclusively, public file first. A non-nil public key on failure means that public
// output was published; callers can report that partial state without deleting it.
func GenerateSigningKeyFile(path, publicPath string, passphrase []byte) (ed25519.PublicKey, error) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, errors.New("generate Ed25519 key: failed")
	}
	defer clear(private)
	encoded, err := EncryptSigningKey(private, passphrase)
	if err != nil {
		return nil, err
	}
	if err := WriteNewReleaseFile(publicPath, []byte(base64.StdEncoding.EncodeToString(public)+"\n")); err != nil {
		return nil, err
	}
	if err := WriteNewReleaseFile(path, encoded); err != nil {
		return public, err
	}
	return public, nil
}

// EncryptSigningKey wraps an in-memory Ed25519 key with a fresh salt and nonce.
// The CLI supplies only a passphrase read from its controlling terminal.
// Clearing secrets is best effort: Go/runtime and cryptographic library copies
// cannot be guaranteed erased. NFC normalization is shared with unlocking.
func EncryptSigningKey(private ed25519.PrivateKey, passphrase []byte) ([]byte, error) {
	if err := ValidateNewSigningKeyPassphrase(passphrase); err != nil {
		return nil, err
	}
	passphrase, err := normalizeSigningKeyPassphrase(passphrase)
	if err != nil {
		return nil, err
	}
	defer clear(passphrase)
	if !validSigningKey(private) {
		return nil, errors.New("invalid Ed25519 private key")
	}
	salt, nonce := make([]byte, 16), make([]byte, chacha20poly1305.NonceSizeX)
	if _, err := rand.Read(salt); err != nil {
		return nil, errors.New("generate container salt: failed")
	}
	if _, err := rand.Read(nonce); err != nil {
		return nil, errors.New("generate container nonce: failed")
	}
	public := private.Public().(ed25519.PublicKey)
	header := signingKeyHeaderV1{
		Format: signingKeyContainerFormat, Version: 1,
		PublicKey: base64.StdEncoding.EncodeToString(public), Fingerprint: KeyFingerprint(public),
		KDF:    signingKeyKDFV1{Name: "argon2id", Version: argon2.Version, Salt: base64.StdEncoding.EncodeToString(salt), MemoryKiB: 64 * 1024, Iterations: 3, Parallelism: 4},
		Cipher: "xchacha20-poly1305", Nonce: base64.StdEncoding.EncodeToString(nonce),
	}
	aad, _ := json.Marshal(header)
	derived := deriveSigningKey(passphrase, salt, header.KDF)
	defer clear(derived)
	aead, err := chacha20poly1305.NewX(derived)
	if err != nil {
		return nil, errors.New("initialize key encryption: failed")
	}
	sealed := aead.Seal(nil, nonce, private[:ed25519.SeedSize], aad)
	encoded, err := json.Marshal(signingKeyContainerV1{Header: header, Ciphertext: base64.StdEncoding.EncodeToString(sealed)})
	if err != nil {
		return nil, errors.New("encode encrypted key container: failed")
	}
	return append(encoded, '\n'), nil
}

// ReadSigningKeyPublicFile unlocks the container and derives its authenticated
// public identity from the seed; clear header metadata is a consistency check.
func ReadSigningKeyPublicFile(path string, passphrase []byte) (ed25519.PublicKey, error) {
	private, err := ReadSigningKeyFile(path, passphrase)
	if err != nil {
		return nil, err
	}
	defer clear(private)
	return private.Public().(ed25519.PublicKey), nil
}

// ValidateSigningKeyContainerFile checks the bounded container format before an
// owner prompt. It never returns the unauthenticated clear public identity.
func ValidateSigningKeyContainerFile(path string) error {
	_, err := readSigningKeyContainer(path)
	return err
}

// ReadSigningKeyFile decrypts a bounded, regular operator/root-owned container.
// Plain PKCS#8 is refused. Only drvfs/9p, FAT and exFAT may relax owner-only mode;
// the passphrase authenticates metadata and unlocks the seed on every filesystem.
func ReadSigningKeyFile(path string, passphrase []byte) (ed25519.PrivateKey, error) {
	container, err := readSigningKeyContainer(path)
	if err != nil {
		return nil, err
	}
	passphrase, err = normalizeSigningKeyPassphrase(passphrase)
	if err != nil {
		return nil, err
	}
	defer clear(passphrase)
	header := container.Header
	salt, _ := decodeContractBase64(header.KDF.Salt, 16)
	nonce, _ := decodeContractBase64(header.Nonce, chacha20poly1305.NonceSizeX)
	ciphertext, _ := decodeContractBase64(container.Ciphertext, ed25519.SeedSize+chacha20poly1305.Overhead)
	aad, _ := json.Marshal(header)
	derived := deriveSigningKey(passphrase, salt, header.KDF)
	defer clear(derived)
	aead, err := chacha20poly1305.NewX(derived)
	if err != nil {
		return nil, errors.New("initialize key decryption: failed")
	}
	seed, err := aead.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return nil, errors.New("unlock encrypted key: wrong passphrase or tampered container")
	}
	defer clear(seed)
	private := ed25519.NewKeyFromSeed(seed)
	public := private.Public().(ed25519.PublicKey)
	if KeyFingerprint(public) != header.Fingerprint || base64.StdEncoding.EncodeToString(public) != header.PublicKey {
		clear(private)
		return nil, errors.New("unlocked key disagrees with container public identity")
	}
	return private, nil
}

func readSigningKeyContainer(path string) (*signingKeyContainerV1, error) {
	return readSigningKeyContainerWithFilesystem(path, unix.Fstatfs)
}

// Inject only the filesystem probe in tests; ownership, mode and bytes still
// come from the same no-follow descriptor that production opens and reads.
func readSigningKeyContainerWithFilesystem(path string, fstatfs func(int, *unix.Statfs_t) error) (*signingKeyContainerV1, error) {
	data, err := readBoundedReleaseFile(path, MaxSigningKeyContainerBytes, func(fd int, stat *unix.Stat_t) error {
		var filesystem unix.Statfs_t
		if err := fstatfs(fd, &filesystem); err != nil {
			return errors.New("cannot determine signing-key filesystem permissions")
		}
		forbidden := uint32(0077)
		switch filesystem.Type {
		case 0x01021997, 0x4d44, 0x2011bab0: // V9FS_MAGIC (drvfs/9p), FAT, exFAT.
			forbidden = 0
		}
		return validateProtectedReleaseFile(stat, forbidden)
	})
	if err != nil {
		return nil, err
	}
	if bytes.Contains(data, []byte("-----BEGIN")) {
		return nil, errors.New("plain PKCS#8/PEM signing keys are refused; generate a passphrase-encrypted container with keygen")
	}
	var container signingKeyContainerV1
	if err := decodeContractJSON(data, MaxSigningKeyContainerBytes, &container); err != nil {
		return nil, errors.New("invalid encrypted signing-key container")
	}
	h := container.Header
	k := h.KDF
	if h.Format != signingKeyContainerFormat || h.Version != 1 || h.Cipher != "xchacha20-poly1305" || k.Name != "argon2id" || k.Version != argon2.Version || k.MemoryKiB < 64*1024 || k.MemoryKiB > 256*1024 || k.Iterations < 1 || k.Iterations > 6 || k.Parallelism < 1 || k.Parallelism > 4 {
		return nil, errors.New("unsupported container format or bounded Argon2id parameters")
	}
	public, err := decodeContractBase64(h.PublicKey, ed25519.PublicKeySize)
	if err != nil || smallOrderEd25519PublicKey(public) || !contractHashPattern.MatchString(h.Fingerprint) || KeyFingerprint(ed25519.PublicKey(public)) != h.Fingerprint {
		return nil, errors.New("invalid container public key or fingerprint")
	}
	for _, field := range []struct {
		value string
		size  int
	}{{k.Salt, 16}, {h.Nonce, chacha20poly1305.NonceSizeX}, {container.Ciphertext, ed25519.SeedSize + chacha20poly1305.Overhead}} {
		if _, err := decodeContractBase64(field.value, field.size); err != nil {
			return nil, errors.New("invalid container salt, nonce or ciphertext")
		}
	}
	return &container, nil
}

func deriveSigningKey(passphrase, salt []byte, kdf signingKeyKDFV1) []byte {
	return argon2.IDKey(passphrase, salt, kdf.Iterations, kdf.MemoryKiB, kdf.Parallelism, chacha20poly1305.KeySize)
}

// ValidateNewSigningKeyPassphrase enforces twelve Unicode characters after NFC
// normalization for new containers. Existing containers can still unlock shorter
// passphrases; normalization applies to both creation and unlocking.
func ValidateNewSigningKeyPassphrase(passphrase []byte) error {
	normalized, err := normalizeSigningKeyPassphrase(passphrase)
	if err != nil {
		return err
	}
	defer clear(normalized)
	if utf8.RuneCount(normalized) < 12 {
		return errors.New("new release-key passphrase must contain at least 12 characters")
	}
	return nil
}

func normalizeSigningKeyPassphrase(passphrase []byte) ([]byte, error) {
	if len(passphrase) == 0 {
		return nil, errors.New("passphrase must not be empty")
	}
	if !utf8.Valid(passphrase) {
		return nil, errors.New("passphrase must be valid Unicode UTF-8")
	}
	return norm.NFC.Append([]byte{}, passphrase...), nil
}

func validSigningKey(key ed25519.PrivateKey) bool {
	if len(key) != ed25519.PrivateKeySize {
		return false
	}
	regenerated := ed25519.NewKeyFromSeed(key[:ed25519.SeedSize])
	defer clear(regenerated)
	return bytes.Equal(regenerated, key)
}
