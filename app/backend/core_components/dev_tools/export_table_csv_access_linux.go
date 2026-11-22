//go:build linux

// export_table_csv_access_linux.go
// Carries an export's owner, group and POSIX access ACL over to its replacement.
// Bridges the atomic CSV publication with Linux file ownership and extended attributes.
// Exists so replacing an export never widens or narrows who may read it.
package devtools

import (
	"errors"
	"os"
	"syscall"
)

const posixACLAccess = "system.posix_acl_access"

// csvOwner returns the owner and group a replacement export must keep.
func csvOwner(info os.FileInfo) (uid, gid int, ok bool) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, 0, false
	}
	return int(st.Uid), int(st.Gid), true
}

// copyCSVAccessRules gives to exactly the access ACL of from. Without one on
// from, it removes any ACL to inherited from a default ACL on the directory,
// which a later chmod would otherwise bring into force. Call it while to is
// still private: installing an ACL also sets the matching permission bits.
func copyCSVAccessRules(from, to string) error {
	acl, err := readCSVAccessACL(from)
	if err != nil {
		return err
	}
	if acl == nil {
		err := syscall.Removexattr(to, posixACLAccess)
		if err == nil || errors.Is(err, syscall.ENODATA) || errors.Is(err, syscall.ENOTSUP) {
			return nil
		}
		return err
	}
	return syscall.Setxattr(to, posixACLAccess, acl, 0)
}

// readCSVAccessACL returns nil when the file has no access ACL or the
// filesystem does not support ACLs.
func readCSVAccessACL(path string) ([]byte, error) {
	size, err := syscall.Getxattr(path, posixACLAccess, nil)
	if errors.Is(err, syscall.ENODATA) || errors.Is(err, syscall.ENOTSUP) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	acl := make([]byte, size)
	n, err := syscall.Getxattr(path, posixACLAccess, acl)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, nil
	}
	return acl[:n], nil
}
