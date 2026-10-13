// main.go: site_favicon_variants tool
// Replicates each maintained 16px favicon into a lossless 128px PNG.
// Connects source pixels to browser-downsampled site identity assets.
// Uses only Go's standard library; run from the repository root with:
// go run app/server_tools/site_favicon_variants/main.go
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	files, err := filepath.Glob("app/frontend/icons/site_favicons/*-16.png")
	if err != nil || len(files) == 0 {
		fmt.Fprintln(os.Stderr, "NOT completed: no source favicons found; run from the repository root.")
		os.Exit(1)
	}
	for index, source := range files {
		fmt.Printf("%d/%d Replicate %s\n", index+1, len(files), source)
		if err := replicate(source); err != nil {
			fmt.Fprintf(os.Stderr, "NOT completed: %d/%d icons succeeded; failed: %s: %v\n", index, len(files), source, err)
			os.Exit(1)
		}
	}
	fmt.Printf("Completed: %d/%d icons succeeded.\n", len(files), len(files))
}

func replicate(source string) error {
	file, err := os.Open(source)
	if err != nil {
		return err
	}
	original, err := png.Decode(file)
	file.Close()
	if err != nil {
		return err
	}
	if original.Bounds().Size() != image.Pt(16, 16) {
		return fmt.Errorf("source must be 16x16, got %v", original.Bounds())
	}
	variant := image.NewNRGBA(image.Rect(0, 0, 128, 128))
	for y := 0; y < 128; y++ {
		for x := 0; x < 128; x++ {
			// NRGBA keeps unpremultiplied colour and alpha, including transparent pixels.
			pixel := color.NRGBAModel.Convert(original.At(x/8, y/8)).(color.NRGBA)
			variant.SetNRGBA(x, y, pixel)
		}
	}
	output, err := os.Create(strings.TrimSuffix(source, "-16.png") + "-128.png")
	if err != nil {
		return err
	}
	encodeErr := png.Encode(output, variant)
	closeErr := output.Close()
	if encodeErr != nil {
		return encodeErr
	}
	return closeErr
}
