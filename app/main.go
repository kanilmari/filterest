// main.go
// Boots Filterest through the shared importable application runtime.
// Bridges executable build identity and extension imports with public startup.
// Exists as the thin composition root used by current local and release builds.
package main

import application_runtime "easelect/backend/core_components/application_runtime"

// buildEnv is set at compile time via -ldflags.
// A prod value cannot be downgraded by runtime environment variables.
var buildEnv = "dev"

func main() {
	application_runtime.Run(application_runtime.Options{
		BuildEnvironment: buildEnv,
	})
}
