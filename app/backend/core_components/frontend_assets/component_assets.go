// component_assets.go
// Confines public feature assets to each component's frontend directory.
// Connects the components route and early URL guard to the shared asset cache policy.
// Refuses source, tests, symlinks and directories before net/http can serve them.
package frontendassets

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"easelect/backend/core_components/middlewares"
)

// WithComponentAssetPathGuard must wrap ServeMux: the mux otherwise redirects
// literal dot segments before the components handler can refuse them with 404.
func WithComponentAssetPathGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		componentNamespace := r.URL.Path == "/components" || strings.HasPrefix(r.URL.Path, "/components/") ||
			strings.HasPrefix(r.URL.Path, "/components%") || strings.HasPrefix(r.URL.Path, "/components\\")
		if componentNamespace && !middlewares.ComponentAssetPath(r) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ComponentFileServer keeps the shared frontend cache policy while opening only
// regular files inside a rooted frontend filesystem. All symlinks are refused.
func ComponentFileServer(directory string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if !middlewares.ComponentAssetPath(r) {
			http.NotFound(w, r)
			return
		}
		parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/components/"), "/", 3)
		info, err := os.Lstat(directory)
		if err != nil || !info.IsDir() {
			http.NotFound(w, r)
			return
		}
		root, err := os.OpenRoot(directory)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer root.Close()
		component, err := openComponentDirectory(root, parts[0])
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer component.Close()
		frontend, err := openComponentDirectory(component, "frontend")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer frontend.Close()
		files := componentFrontendFS{frontend}
		// FileServer redirects index.html before opening it. Validate first so
		// missing files, directories and symlinks always produce 404 instead.
		file, err := files.Open(parts[2])
		if err != nil {
			http.NotFound(w, r)
			return
		}
		file.Close()
		http.StripPrefix("/components/"+parts[0]+"/frontend/", fileServer(files)).ServeHTTP(w, r)
	})
}

func openComponentDirectory(root *os.Root, name string) (*os.Root, error) {
	info, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fs.ErrNotExist
	}
	return root.OpenRoot(name)
}

type componentFrontendFS struct{ root *os.Root }

func (files componentFrontendFS) Open(name string) (http.File, error) {
	name = strings.TrimPrefix(name, "/")
	if !middlewares.ComponentAssetFile(name) {
		return nil, fs.ErrNotExist
	}
	parts := strings.Split(name, "/")
	for index := range parts {
		info, err := files.root.Lstat(strings.Join(parts[:index+1], "/"))
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return nil, fs.ErrNotExist
		}
	}
	file, err := files.root.Open(name)
	if err != nil {
		return nil, fs.ErrNotExist
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, fs.ErrNotExist
	}
	return file, nil
}

// ComponentsDirectory validates the sibling of the canonical frontend directory.
// Missing components are supported for older compositions; nothing is created.
func ComponentsDirectory(frontendDirectory string) (string, error) {
	frontend, err := filepath.EvalSymlinks(frontendDirectory)
	if err != nil {
		return "", err
	}
	frontend, err = filepath.Abs(frontend)
	if err != nil {
		return "", err
	}
	directory := filepath.Join(filepath.Dir(frontend), "components")
	info, err := os.Lstat(directory)
	if os.IsNotExist(err) {
		return directory, nil
	}
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", &os.PathError{Op: "validate components sibling directory", Path: directory, Err: fs.ErrInvalid}
	}
	return directory, nil
}
