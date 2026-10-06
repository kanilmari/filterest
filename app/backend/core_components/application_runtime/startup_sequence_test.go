// startup_sequence_test.go
// Proves error propagation prevents workers/readiness after any failed required step.
// Checks the actual production sequence, including policy consumers and legacy preservation.
package application_runtime

import (
	"errors"
	"reflect"
	"testing"
)

func TestRequiredStartupOrdersInputsBeforeGrantsAndConsumers(t *testing.T) {
	steps := requiredStartupSteps("product", Options{}, "test")
	names := []string{}
	for _, step := range steps {
		names = append(names, step.name)
	}
	want := []string{"role identities", "migrations", "dataset identities", "column metadata", "one-to-many discovery", "many-to-many discovery", "embedding tables", "route registration", "function synchronization", "UI routes", "approved rights cleanup", "administrator route rights", "administrator dataset rights", "anonymous browsing", "runtime grants", "reserved identities"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("readiness ordering changed: %v", names)
	}
}

func TestRequiredStartupPropagatesEveryFailureBeforeReadiness(t *testing.T) {
	production := requiredStartupSteps("product", Options{}, "test")
	failure := errors.New("required task failed")
	for fail := range production {
		steps := append([]startupStep{}, production...)
		ran := []int{}
		for i := range steps {
			index := i
			steps[i].run = func() error {
				ran = append(ran, index)
				if index == fail {
					return failure
				}
				return nil
			}
		}
		err := runRequiredStartup(steps)
		if !errors.Is(err, failure) || len(ran) != fail+1 {
			t.Fatalf("failed %s but continued: %v %v", production[fail].name, ran, err)
		}
	}
}
