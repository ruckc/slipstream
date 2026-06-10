package controller

// Config holds cluster-level configuration injected via env vars or a ConfigMap.
// Images and gateway settings are set once at the operator level, not per-CR.
type Config struct {
	AgentImage           string
	MetricsSidecarImage  string // empty = no sidecar
	MetricsPushURL       string // empty = no idle detection
	GatewayName          string
	GatewayNamespace     string
	GatewayHostname      string
	GatewayListenerHTTPS string // listener name, default "https"
	WebNamespace         string // namespace of the web app, for JWKS URL
}

func (c *Config) JWKSUrl() string {
	ns := c.WebNamespace
	if ns == "" {
		ns = "slipstream-system"
	}
	return "http://slipstream-web." + ns + ".svc.cluster.local/api/jwks"
}

func (c *Config) gatewayListenerHTTPS() string {
	if c.GatewayListenerHTTPS != "" {
		return c.GatewayListenerHTTPS
	}
	return "https"
}
