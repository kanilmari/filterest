// media_folders_test.go
// Verifies that read-only media checks and filesystem repairs accept only their intended HTTP methods.
// Bridges handler entry guards and the API pipeline's CSRF protection contract.
// Exists to prevent state-changing media repairs from becoming callable as unprotected GET requests.
package system_table_tools
