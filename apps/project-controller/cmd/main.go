package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"slipstream/project-controller/internal/controller"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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

	cfg := &controller.Config{
		AgentImage:           requireEnv("AGENT_IMAGE"),
		BuildkitImage:        getEnvOrDefault("BUILDKIT_IMAGE", "moby/buildkit:v0.20.2-rootless@sha256:cb5bb371545222c430528556acfdf424144b69897f5deaad391bd227187e90df"),
		GatewayName:          requireEnv("GATEWAY_NAME"),
		GatewayNamespace:     requireEnv("GATEWAY_NAMESPACE"),
		GatewayHostname:      requireEnv("GATEWAY_HOSTNAME"),
		GatewayListenerHTTPS: getEnvOrDefault("GATEWAY_LISTENER_HTTPS", "https"),
		Namespace:            resolveNamespace(),
		MetricsToken:         os.Getenv("METRICS_TOKEN"),
		StorageClass:         os.Getenv("AGENT_STORAGE_CLASS"),
		HarborNamespace:      os.Getenv("HARBOR_NAMESPACE"),
		RegistryInsecure:     os.Getenv("REGISTRY_INSECURE"),
		HarborURL:            os.Getenv("HARBOR_URL"),
		HarborAdminUsername:  os.Getenv("HARBOR_ADMIN_USERNAME"),
		HarborAdminPassword:  os.Getenv("HARBOR_ADMIN_PASSWORD"),
		RegistryHost:         os.Getenv("REGISTRY_HOST"),
	}

	// Resolve the actual Kubernetes API server endpoint IP and port from the
	// "kubernetes" Endpoints in the default namespace. Cilium (in kube-proxy
	// replacement mode) enforces egress policy on the post-DNAT destination, so
	// we must allow the real server IP, not the ClusterIP virtual address.
	if ep, err := kubeclient.CoreV1().Endpoints("default").Get(context.Background(), "kubernetes", metav1.GetOptions{}); err != nil {
		klog.Warningf("could not resolve kubernetes endpoint: %v — kubeDeployAccess egress rule will be skipped", err)
	} else {
		for _, subset := range ep.Subsets {
			if len(subset.Addresses) > 0 {
				cfg.KubeAPIServerHost = subset.Addresses[0].IP
				for _, port := range subset.Ports {
					if port.Name == "https" || port.Port == 443 || port.Port == 6443 {
						cfg.KubeAPIServerPort = fmt.Sprintf("%d", port.Port)
						break
					}
				}
				break
			}
		}
		klog.Infof("Kubernetes API server endpoint: %s:%s", cfg.KubeAPIServerHost, cfg.KubeAPIServerPort)
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
