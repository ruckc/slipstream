package controller

// Config holds cluster-level configuration injected via env vars or a ConfigMap.
// Images and gateway settings are set once at the operator level, not per-CR.
type Config struct {
	AgentImage           string
	GatewayName          string
	GatewayNamespace     string
	GatewayHostname      string
	GatewayListenerHTTPS string // listener name, default "https"
	Namespace            string // controller's own namespace, resolved at startup
	MetricsToken         string // shared bearer token for /metrics endpoints on agent pods
	StorageClass         string // PVC storage class; empty string uses the cluster default
	HarborNamespace      string // namespace where Harbor runs; pods get egress to it for push/pull
	RegistryInsecure     string // "true" in dev so buildah treats REGISTRY_HOST as insecure (HTTP/self-signed)
}

func (c *Config) JWKSUrl() string {
	return "http://slipstream-web." + c.Namespace + ".svc.cluster.local/api/jwks"
}

func (c *Config) gatewayListenerHTTPS() string {
	if c.GatewayListenerHTTPS != "" {
		return c.GatewayListenerHTTPS
	}
	return "https"
}
