package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
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
	flag.Parse()

	cfg := &controller.Config{
		AgentImage:           requireEnv("AGENT_IMAGE"),
		MetricsSidecarImage:  os.Getenv("METRICS_SIDECAR_IMAGE"),
		MetricsPushURL:       os.Getenv("METRICS_PUSH_URL"),
		GatewayName:          requireEnv("GATEWAY_NAME"),
		GatewayNamespace:     requireEnv("GATEWAY_NAMESPACE"),
		GatewayHostname:      requireEnv("GATEWAY_HOSTNAME"),
		GatewayListenerHTTPS: getEnvOrDefault("GATEWAY_LISTENER_HTTPS", "https"),
		WebNamespace:         getEnvOrDefault("WEB_NAMESPACE", "slipstream-system"),
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
