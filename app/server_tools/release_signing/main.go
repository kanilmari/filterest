// main.go
// Runs offline key generation, public-identity inspection and release signing.
// Connects product-selected USB container paths to terminal-only owner passphrases.
// Enforces canonical documents, exclusive outputs and truthful failed-step reports.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	releaseupdates "easelect/backend/core_components/release_updates"
	"golang.org/x/sys/unix"
	"golang.org/x/term"
)

const usage = `Usage: release_signing keygen|fingerprint|sign|sign-policy --product filterest|easelect [file options]
Private key path: FILTEREST_RELEASE_SIGNING_KEY_FILE or EASELECT_RELEASE_SIGNING_KEY_FILE.
Only passphrase-encrypted containers are supported. Passphrases are read without
 echo from the controlling terminal, never flags, environment, files or stdin.
keygen requires at least 12 characters, confirms twice and writes public output first.
Passphrases use Unicode NFC for key derivation; secret zeroing is best effort.
fingerprint unlocks the container and prints identity derived from the decrypted seed.
WSL USB example (Windows drive E:):
 sudo mount -t drvfs E: /mnt/release-key -o metadata,uid=$(id -u),gid=$(id -g),umask=077
Containers require owner-only permissions except on drvfs/9p, FAT and exFAT.
All require a regular, bounded, operator/root-owned file without a final symlink.
Keep the USB and backup with the owner.`

func main() { os.Exit(run(os.Args[1:], os.Stderr)) }

func run(arguments []string, output io.Writer) int {
	return runWithPassphraseReader(arguments, output, readTerminalPassphrase)
}

// Injection is private to Go tests; the production command has no alternate
// passphrase source, flag or environment switch.
func runWithPassphraseReader(arguments []string, output io.Writer, readPassphrase func(string) ([]byte, error)) int {
	if len(arguments) == 0 || (len(arguments) == 1 && (arguments[0] == "--help" || arguments[0] == "-h")) {
		if len(arguments) == 0 {
			fmt.Fprintln(output, "Failed step 0 (select operation): operation is required")
		}
		fmt.Fprintln(output, usage)
		if len(arguments) == 0 {
			return 2
		}
		return 0
	}
	command := arguments[0]
	if command != "keygen" && command != "fingerprint" && command != "sign" && command != "sign-policy" {
		fmt.Fprintln(output, "Failed step 0 (select operation): unknown signing operation")
		return 2
	}
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	product := flags.String("product", "", "Product selecting the encrypted-key path")
	publicPath := flags.String("public-key-file", "", "New public-key output file (keygen)")
	documentPath := flags.String("input-file", "", "Canonical manifest or policy file (sign/sign-policy)")
	signaturePath := flags.String("output-file", "", "New detached signature output file (sign/sign-policy)")
	appendPath := flags.String("append-signatures-file", "", "Existing proofs to combine for rotation (sign/sign-policy)")
	if err := flags.Parse(arguments[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(output, usage)
			flags.SetOutput(output)
			flags.PrintDefaults()
			return 0
		}
		fmt.Fprintf(output, "Failed step 0 (parse arguments): %v\n", err)
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(output, "Failed step 0 (parse arguments): unexpected positional arguments")
		return 2
	}
	variable := ""
	switch *product {
	case "filterest":
		variable = "FILTEREST_RELEASE_SIGNING_KEY_FILE"
	case "easelect":
		variable = "EASELECT_RELEASE_SIGNING_KEY_FILE"
	default:
		fmt.Fprintln(output, "Failed step 0 (select product): select filterest or easelect")
		return 2
	}
	keyPath := os.Getenv(variable)
	if keyPath == "" {
		fmt.Fprintf(output, "Failed step 0 (select key path): set %s\n", variable)
		return 2
	}
	if command == "fingerprint" {
		if *publicPath != "" || *documentPath != "" || *signaturePath != "" || *appendPath != "" {
			fmt.Fprintln(output, "Failed step 0 (validate arguments): fingerprint requires only --product")
			return 2
		}
		passphrase, err := readPassphrase("Release-key passphrase: ")
		defer clear(passphrase)
		var public []byte
		if err == nil {
			public, err = releaseupdates.ReadSigningKeyPublicFile(keyPath, passphrase)
		}
		if err != nil {
			fmt.Fprintf(output, "Failed step 1 (unlock container public identity): %v\n", err)
			return 1
		}
		fmt.Fprintf(output, "Public key: %s\nFingerprint: %s\n", base64.StdEncoding.EncodeToString(public), releaseupdates.KeyFingerprint(public))
		return 0
	}
	if command == "keygen" {
		if *publicPath == "" || *documentPath != "" || *signaturePath != "" || *appendPath != "" {
			fmt.Fprintln(output, "Failed step 0 (validate arguments): keygen requires only --product and --public-key-file")
			return 2
		}
		fmt.Fprintln(output, "1/2: Confirm owner passphrase and create public-key output")
		passphrase, err := readPassphrase("New release-key passphrase: ")
		defer clear(passphrase)
		if err == nil {
			err = releaseupdates.ValidateNewSigningKeyPassphrase(passphrase)
		}
		if err == nil {
			confirmation, readErr := readPassphrase("Confirm release-key passphrase: ")
			if readErr != nil {
				err = readErr
			} else if !bytes.Equal(passphrase, confirmation) {
				err = errors.New("passphrases do not match")
			}
			clear(confirmation)
		}
		if err != nil {
			fmt.Fprintf(output, "NOT completed: 0/2 steps; failed step 1 (confirm owner passphrase): %v\n", err)
			return 1
		}
		public, err := releaseupdates.GenerateSigningKeyFile(keyPath, *publicPath, passphrase)
		if err != nil {
			if public == nil {
				fmt.Fprintf(output, "NOT completed: 0/2 steps; failed step 1 (create public-key output): %v\n", err)
			} else {
				fmt.Fprintf(output, "NOT completed: 1/2 steps; failed step 2 (create encrypted container); public-key output created; fingerprint: %s; %v\n", releaseupdates.KeyFingerprint(public), err)
			}
			return 1
		}
		fmt.Fprintf(output, "Completed: 2/2 steps; public key and encrypted container created; fingerprint: %s\n", releaseupdates.KeyFingerprint(public))
		return 0
	}
	if *documentPath == "" || *signaturePath == "" || *publicPath != "" {
		fmt.Fprintln(output, "Failed step 0 (validate arguments): signing requires --product, --input-file and --output-file")
		return 2
	}
	fmt.Fprintln(output, "1/3: Validate canonical signing document and composition")
	maximum := releaseupdates.MaxManifestBytes
	if command == "sign-policy" {
		maximum = releaseupdates.MaxTrustPolicyBytes
	}
	data, err := readInput(*documentPath, maximum)
	var policy *releaseupdates.TrustPolicyV1
	if err == nil && command == "sign" {
		var manifest *releaseupdates.ManifestV1
		manifest, err = releaseupdates.ParseManifest(data)
		if err == nil && manifest.Composition.ID != *product {
			err = errors.New("signing product does not match manifest composition")
		}
	} else if err == nil {
		policy, err = releaseupdates.ParseTrustPolicy(data)
		if err == nil {
			found := false
			for _, scope := range policy.Compositions {
				if scope.ID == *product {
					found = true
				}
			}
			if !found {
				err = errors.New("signing product is not enrolled in the policy")
			}
		}
	}
	if err == nil {
		err = releaseupdates.ValidateCanonicalReleaseJSON(data)
	}
	if err != nil {
		fmt.Fprintf(output, "NOT completed: 0/3 steps; failed step 1 (validate canonical document and composition): %v\n", err)
		return 1
	}
	fmt.Fprintln(output, "2/3: Unlock encrypted key, sign bytes and check appended proofs")
	err = releaseupdates.ValidateSigningKeyContainerFile(keyPath) // Refuse plain keys before asking the owner.
	var passphrase []byte
	if err == nil {
		passphrase, err = readPassphrase("Release-key passphrase: ")
	}
	defer clear(passphrase)
	var key []byte
	if err == nil {
		key, err = releaseupdates.ReadSigningKeyFile(keyPath, passphrase)
	}
	defer clear(key)
	var envelope *releaseupdates.SignatureEnvelopeV1
	if err == nil {
		if command == "sign" {
			envelope, err = releaseupdates.SignManifest(data, key)
		} else {
			envelope, err = releaseupdates.SignTrustPolicy(data, key)
		}
	}
	if err == nil && *appendPath != "" {
		var existing []byte
		existing, err = readInput(*appendPath, releaseupdates.MaxSignatureBytes)
		if err == nil {
			var oldEnvelope *releaseupdates.SignatureEnvelopeV1
			oldEnvelope, err = releaseupdates.ParseSignatures(existing, envelope.Domain)
			if err == nil {
				envelope, err = releaseupdates.MergeSignatures(oldEnvelope, envelope)
			}
		}
	}
	if err == nil && command == "sign-policy" {
		err = releaseupdates.VerifyTrustPolicySignatureProofs(data, envelope, policy)
	}
	if err != nil {
		fmt.Fprintf(output, "NOT completed: 1/3 steps; failed step 2 (unlock key, sign bytes and check appended proofs): %v\n", err)
		return 1
	}
	fmt.Fprintln(output, "3/3: Write detached signature envelope")
	encoded, err := json.Marshal(envelope)
	if err == nil {
		err = writeNewOutput(*signaturePath, append(encoded, '\n'))
	}
	if err != nil {
		fmt.Fprintf(output, "NOT completed: 2/3 steps; failed step 3 (write detached signatures): %v\n", err)
		return 1
	}
	fmt.Fprintln(output, "Completed: 3/3 steps; detached signature file created")
	return 0
}

// readTerminalPassphrase always opens the controlling terminal explicitly.
// An input pipe, redirected stdin or missing terminal cannot supply a passphrase.
func readTerminalPassphrase(prompt string) ([]byte, error) {
	fd, err := unix.Open("/dev/tty", unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, errors.New("controlling terminal required for owner passphrase")
	}
	terminal := os.NewFile(uintptr(fd), "/dev/tty")
	defer terminal.Close()
	if !term.IsTerminal(fd) {
		return nil, errors.New("controlling terminal required for owner passphrase")
	}
	if _, err := fmt.Fprint(terminal, prompt); err != nil {
		return nil, errors.New("cannot prompt on controlling terminal")
	}
	passphrase, err := term.ReadPassword(fd)
	fmt.Fprintln(terminal)
	if err != nil {
		clear(passphrase)
		return nil, errors.New("cannot read passphrase from controlling terminal")
	}
	if len(passphrase) == 0 {
		return nil, errors.New("passphrase must not be empty")
	}
	return passphrase, nil
}

func readInput(path string, maximum int) ([]byte, error) {
	return releaseupdates.ReadReleaseInputFile(path, maximum)
}

func writeNewOutput(path string, data []byte) error {
	return releaseupdates.WriteNewReleaseFile(path, data)
}
