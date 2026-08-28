// trusted_proxy_config.go
// Parses the explicit reverse-proxy trust boundary used for client IP headers.
// Bridges protected runtime configuration with firewall and rate-limit identity.
// Exists so Docker gateways can be trusted exactly without trusting private LANs.
package firewall

import (
	"fmt"
	"net"
	"os"
	"strings"
)

const trustedProxyPeerIPsEnv = "EASELECT_TRUSTED_PROXY_PEER_IPS"

// These defaults preserve the established Cloudflare and loopback boundary.
// Deployment-specific Docker or host proxy addresses must be added explicitly.
var defaultTrustedProxyCIDRs = []string{
	"173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22",
	"103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
	"190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22",
	"198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
	"104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
	"2400:cb00::/32", "2606:4700::/32", "2803:f800::/32",
	"2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29",
	"2c0f:f248::/32", "127.0.0.1/32", "::1/128",
}

type trustedProxyResolver struct {
	networks []*net.IPNet
}

// Defaults are available to package helpers and tests without reading runtime
// configuration before the application's protected env files have loaded.
var defaultTrustedProxyResolver = &trustedProxyResolver{
	networks: mustTrustedProxyNetworks(""),
}

func mustParseBuiltInCIDRs(cidrs []string) []*net.IPNet {
	networks := make([]*net.IPNet, 0, len(cidrs))
	for _, cidr := range cidrs {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			panic(fmt.Sprintf("invalid built-in proxy CIDR %q: %v", cidr, err))
		}
		networks = append(networks, network)
	}
	return networks
}

func mustTrustedProxyNetworks(configured string) []*net.IPNet {
	networks, err := parseTrustedProxyNetworks(configured)
	if err != nil {
		panic(fmt.Sprintf("invalid %s: %v", trustedProxyPeerIPsEnv, err))
	}
	return networks
}

func trustedProxyResolverFromEnvironment() (*trustedProxyResolver, error) {
	networks, err := parseTrustedProxyNetworks(os.Getenv(trustedProxyPeerIPsEnv))
	if err != nil {
		return nil, fmt.Errorf("invalid %s: %w", trustedProxyPeerIPsEnv, err)
	}
	return &trustedProxyResolver{networks: networks}, nil
}

// ValidateTrustedProxyConfiguration is called by the central startup validator
// immediately after protected environment files load and before mutable work.
func ValidateTrustedProxyConfiguration() error {
	_, err := trustedProxyResolverFromEnvironment()
	return err
}

func (resolver *trustedProxyResolver) isTrusted(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	for _, network := range resolver.networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// parseTrustedProxyNetworks appends comma-separated exact deployment peer IPs
// to the built-in CIDRs. It intentionally does not accept operator-supplied
// networks: every Docker/host proxy addition becomes one /32 or /128 host.
func parseTrustedProxyNetworks(configured string) ([]*net.IPNet, error) {
	networks := mustParseBuiltInCIDRs(defaultTrustedProxyCIDRs)
	seen := make(map[string]struct{}, len(networks))
	for _, network := range networks {
		seen[network.String()] = struct{}{}
	}

	if strings.TrimSpace(configured) != "" {
		for index, raw := range strings.Split(configured, ",") {
			entry := strings.TrimSpace(raw)
			if entry == "" {
				return nil, fmt.Errorf("entry %d is empty", index+1)
			}
			ip := net.ParseIP(entry)
			if ip == nil || ip.IsUnspecified() || ip.IsMulticast() {
				return nil, fmt.Errorf("entry %d must be one usable IPv4 or IPv6 peer address", index+1)
			}
			bits := 128
			if ipv4 := ip.To4(); ipv4 != nil {
				ip = ipv4
				bits = 32
			}
			network := &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)}
			canonical := network.String()
			if _, duplicate := seen[canonical]; duplicate {
				continue
			}
			seen[canonical] = struct{}{}
			networks = append(networks, network)
		}
	}
	return networks, nil
}
