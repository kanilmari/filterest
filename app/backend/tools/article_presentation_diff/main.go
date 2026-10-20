// main.go
// Produces the K388 owner list and checks exact approved differences offline.
// Connects two protected report files to Markdown, CSV and digest-bound JSON.
// No database driver, installation configuration or runtime startup is imported.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	compare "easelect/backend/tools/internal/articlecomparison"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
func run(args []string, out, diagnostics io.Writer) int {
	flags := flag.NewFlagSet("article presentation diff", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	beforePath := flags.String("before", "", "BEFORE JSON file")
	afterPath := flags.String("after", "", "AFTER JSON file")
	prefix := flags.String("out", "", "output prefix for .md, .csv and .json (required unless checking)")
	approvedPath := flags.String("check", "", "approved difference JSON file")
	if flags.Parse(args) != nil || flags.NArg() != 0 || *beforePath == "" || *afterPath == "" || (*approvedPath == "" && *prefix == "") || (*approvedPath != "" && *prefix != "") {
		fmt.Fprintln(diagnostics, "error: use --before FILE --after FILE and either --out PREFIX or --check APPROVED.json")
		return 2
	}
	read := func(path, phase string) (compare.Report, error) {
		f, err := os.Open(path)
		if err != nil {
			return compare.Report{}, err
		}
		defer f.Close()
		return compare.ReadReport(f, phase)
	}
	before, err := read(*beforePath, "before")
	if err != nil {
		fmt.Fprintln(diagnostics, "error: invalid BEFORE report")
		return 2
	}
	after, err := read(*afterPath, "after")
	if err != nil {
		fmt.Fprintln(diagnostics, "error: invalid AFTER report")
		return 2
	}
	current, err := compare.Compare(before, after)
	if err != nil {
		fmt.Fprintln(diagnostics, "error: invalid comparison inputs")
		return 2
	}
	if *approvedPath != "" {
		f, err := os.Open(*approvedPath)
		if err != nil {
			fmt.Fprintln(diagnostics, "error: cannot read approval")
			return 2
		}
		defer f.Close()
		approved, err := compare.ReadApproval(f)
		if err != nil {
			fmt.Fprintln(diagnostics, "error: invalid approval or digest")
			return 2
		}
		result, err := compare.Check(current, approved)
		if err != nil {
			fmt.Fprintln(diagnostics, "error: approval does not match the BEFORE evidence")
			return 2
		}
		if result.Equal {
			if _, err := fmt.Fprintln(out, "Approved differences match exactly. SHA256:", current.SHA256); err != nil {
				return 2
			}
			return 0
		}
		for _, entry := range []struct {
			name string
			rows []compare.Difference
		}{{"Unlisted differences", result.Unlisted}, {"Missing approved differences", result.Missing}} {
			fmt.Fprintln(diagnostics, entry.name)
			if err := compare.WriteMarkdown(diagnostics, compare.OwnerRows(entry.rows), 0, current.SHA256); err != nil {
				return 2
			}
		}
		if result.InventoryChanged {
			fmt.Fprintln(diagnostics, "The unchanged comparison inventory also differs.")
		}
		return 1
	}
	rows := compare.OwnerRows(current.Differences)
	var md, csv, raw bytes.Buffer
	if compare.WriteMarkdown(&md, rows, current.Unchanged, current.SHA256) != nil || compare.WriteCSV(&csv, rows, current.Unchanged, current.SHA256) != nil {
		return 2
	}
	encoder := json.NewEncoder(&raw)
	encoder.SetIndent("", "  ")
	if encoder.Encode(current) != nil {
		return 2
	}
	outputs := []struct {
		suffix string
		data   []byte
	}{{".md", md.Bytes()}, {".csv", csv.Bytes()}, {".json", raw.Bytes()}}
	for _, output := range outputs {
		dst, _ := filepath.Abs(*prefix + output.suffix)
		for _, input := range []string{*beforePath, *afterPath} {
			src, _ := filepath.Abs(input)
			if src == dst {
				fmt.Fprintln(diagnostics, "error: output would overwrite input")
				return 2
			}
		}
	}
	for _, output := range outputs {
		if err := writeOutput(*prefix+output.suffix, output.data); err != nil {
			fmt.Fprintln(diagnostics, "error: output not completed")
			return 2
		}
	}
	if _, err := fmt.Fprintln(out, "Owner list and difference evidence written. Approval SHA256:", current.SHA256); err != nil {
		return 2
	}
	return 0
}
func writeOutput(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".article-difference-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
