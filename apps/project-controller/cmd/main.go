package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"slipstream/project-controller/internal/controller"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/klog/v2"
)

func main() {
	klog.InitFlags(nil)
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		klog.Infof("project-controller %s", Version)
		os.Exit(0)
	}

	klog.Infof("project-controller %s starting", Version)

	cfg := &controller.Config{
		AgentImage:           requireEnv("AGENT_IMAGE"),
		GatewayName:          requireEnv("GATEWAY_NAME"),
		GatewayNamespace:     requireEnv("GATEWAY_NAMESPACE"),
		GatewayHostname:      requireEnv("GATEWAY_HOSTNAME"),
		GatewayListenerHTTPS: getEnvOrDefault("GATEWAY_LISTENER_HTTPS", "https"),
		Namespace:            resolveNamespace(),
		MetricsToken:         os.Getenv("METRICS_TOKEN"),
		StorageClass:         os.Getenv("AGENT_STORAGE_CLASS"),
		HarborNamespace:      os.Getenv("HARBOR_NAMESPACE"),
		RegistryInsecure:     os.Getenv("REGISTRY_INSECURE"),
	}

	restCfg, err := loadRestConfig()
	if err != nil {
		klog.Fatalf("failed to build REST config: %v", err)
	}

	kubeclient, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		klog.Fatalf("failed to build kubernetes client: %v", err)
	}

	dynClient, err := dynamic.NewForConfig(restCfg)
	if err != nil {
		klog.Fatalf("failed to build dynamic client: %v", err)
	}

	ctrl := controller.New(cfg, kubeclient, dynClient)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	ctrl.Run(ctx)
}

func loadRestConfig() (*rest.Config, error) {
	kubeconfig := os.Getenv("KUBECONFIG")
	if kubeconfig != "" {
		return clientcmd.BuildConfigFromFlags("", kubeconfig)
	}
	return rest.InClusterConfig()
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		klog.Fatalf("required environment variable %s is not set", key)
	}
	return v
}

func getEnvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// resolveNamespace returns the namespace the controller is running in by reading
// the downward-API-injected file. Falls back to "default" outside the cluster.
func resolveNamespace() string {
	const nsFile = "/var/run/secrets/kubernetes.io/serviceaccount/namespace"
	if data, err := os.ReadFile(nsFile); err == nil {
		if ns := strings.TrimSpace(string(data)); ns != "" {
			return ns
		}
	}
	return "default"
}
