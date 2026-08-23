// operator_terminal_reader.go
// Reads visible confirmations and hidden secrets from the controlling terminal.
// Bridges interactive operators with the recovery command without using argv, environment, or files for new credentials.
// Exists so passwords and fixed PINs never appear in shell history, process listings, logs, or redirected stdin.
package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strings"

	"golang.org/x/term"
)

type operatorTerminal interface {
	Printf(string, ...interface{})
	ReadLine(string) (string, error)
	ReadSecret(string) (string, error)
	Close() error
}

type protectedOperatorTerminal struct {
	file   *os.File
	reader *bufio.Reader
}

// openOperatorTerminal refuses redirected stdin and opens the process's controlling TTY directly.
// This keeps recovery secrets out of pipelines and automation logs.
func openOperatorTerminal() (operatorTerminal, error) {
	file, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return nil, errors.New("a controlling TTY is required; redirected or automated secret input is refused")
	}
	if !term.IsTerminal(int(file.Fd())) {
		_ = file.Close()
		return nil, errors.New("a controlling TTY is required; redirected or automated secret input is refused")
	}
	return &protectedOperatorTerminal{file: file, reader: bufio.NewReader(file)}, nil
}

func (terminal *protectedOperatorTerminal) Printf(format string, values ...interface{}) {
	_, _ = fmt.Fprintf(terminal.file, format, values...)
}

func (terminal *protectedOperatorTerminal) ReadLine(prompt string) (string, error) {
	terminal.Printf("%s", prompt)
	value, err := terminal.reader.ReadString('\n')
	if err != nil {
		return "", fmt.Errorf("read operator confirmation: %w", err)
	}
	return strings.TrimSpace(value), nil
}

// ReadSecret disables terminal echo through x/term and returns the value only to in-process validation.
// Callers pair two reads before accepting a database password, administrator password, or fixed PIN.
func (terminal *protectedOperatorTerminal) ReadSecret(prompt string) (string, error) {
	terminal.Printf("%s", prompt)
	value, err := term.ReadPassword(int(terminal.file.Fd()))
	terminal.Printf("\n")
	if err != nil {
		return "", fmt.Errorf("read hidden operator input: %w", err)
	}
	return string(value), nil
}

func (terminal *protectedOperatorTerminal) Close() error {
	return terminal.file.Close()
}
