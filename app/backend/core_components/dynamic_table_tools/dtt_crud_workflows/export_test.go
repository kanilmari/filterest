// export_test.go
// Shares the existing disposable creation fixture with external lifecycle tests.
// Keeps writer packages that depend on workflows out of an internal test import cycle.
// These aliases are compiled only for tests and add no production API.
package dtt_crud_workflows

var RegistrationDisposableDBForTest = registrationDisposableDB
var LoadPublicBootstrapForTest = loadPublicBootstrap
var PostCreateDatasetForTest = postCreateDataset
