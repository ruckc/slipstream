package controller

import (
	"encoding/base64"
	"fmt"

	"slipstream/project-controller/api/v1alpha1"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func projectNamespace(pe *v1alpha1.ProjectEnvironment) string {
	return "project-" + pe.Spec.ProjectID
}

func pvcName(pe *v1alpha1.ProjectEnvironment) string {
	return "pvc-" + pe.Spec.ProjectID
}

func deploymentName(pe *v1alpha1.ProjectEnvironment) string {
	name := "agent-" + pe.Spec.ProjectID
	if len(name) > 63 {
		name = name[:63]
	}
	return name
}

func serviceName(pe *v1alpha1.ProjectEnvironment) string {
	return "svc-" + pe.Spec.ProjectID
}

func routeName(pe *v1alpha1.ProjectEnvironment) string {
	return "route-" + pe.Spec.ProjectID
}

func networkPolicyName(pe *v1alpha1.ProjectEnvironment) string {
	return "netpol-" + pe.Spec.ProjectID
}

func ciliumPolicyName(pe *v1alpha1.ProjectEnvironment) string {
	return "cnp-" + pe.Spec.ProjectID
}

// registrySecretName is the dockerconfigjson Secret the controller materializes
// from spec.registryAuth and the pod mounts at /etc/registry-auth.
const registrySecretName = "slipstream-registry-auth"

// buildRegistrySecret renders the namespace robot credentials as a
// kubernetes.io/dockerconfigjson Secret in the project namespace.
func buildRegistrySecret(pe *v1alpha1.ProjectEnvironment) *corev1.Secret {
	auth := pe.Spec.RegistryAuth
	token := base64.StdEncoding.EncodeToString([]byte(auth.Username + ":" + auth.Password))
	dockercfg := fmt.Sprintf(
		`{"auths":{%q:{"username":%q,"password":%q,"auth":%q}}}`,
		auth.Server, auth.Username, auth.Password, token,
	)
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      registrySecretName,
			Namespace: projectNamespace(pe),
			Labels:    projectLabels(pe),
		},
		Type: corev1.SecretTypeDockerConfigJson,
		Data: map[string][]byte{
			corev1.DockerConfigJsonKey: []byte(dockercfg),
		},
	}
}

func desiredReplicas(pe *v1alpha1.ProjectEnvironment) int32 {
	if pe.Spec.DesiredState == "running" {
		return 1
	}
	return 0
}

func buildNamespace(pe *v1alpha1.ProjectEnvironment) *corev1.Namespace {
	labels := projectLabels(pe)
	labels["slipstream.io/managed"] = "true"
	labels[LabelProject] = "true"
	// Enforce Pod Security Standards baseline profile: blocks privileged containers,
	// hostNetwork, hostPID, hostIPC, and other cluster-impacting capabilities.
	labels["pod-security.kubernetes.io/enforce"] = "baseline"
	labels["pod-security.kubernetes.io/enforce-version"] = "latest"
	return &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:   projectNamespace(pe),
			Labels: labels,
		},
	}
}

func buildPVC(pe *v1alpha1.ProjectEnvironment, storageClass string) *corev1.PersistentVolumeClaim {
	sc := storageClass
	storageGB := pe.Spec.StorageGB
	if storageGB < 1 {
		storageGB = 10
	}
	return &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      pvcName(pe),
			Namespace: projectNamespace(pe),
			Labels:    projectLabels(pe),
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			StorageClassName: func() *string {
				if sc == "" {
					return nil
				}
				return &sc
			}(),
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: resource.MustParse(fmt.Sprintf("%dGi", storageGB)),
				},
			},
		},
	}
}

func buildDeployment(pe *v1alpha1.ProjectEnvironment, cfg *Config) *appsv1.Deployment {
	ns := projectNamespace(pe)
	name := deploymentName(pe)
	labels := projectLabels(pe)
	replicas := desiredReplicas(pe)

	containers := []corev1.Container{
		{
			Name:            "agent",
			Image:           cfg.AgentImage,
			ImagePullPolicy: corev1.PullAlways,
			Ports:           []corev1.ContainerPort{{ContainerPort: 8080}},
			Env: []corev1.EnvVar{
				{Name: "JWKS_URL", Value: cfg.JWKSUrl()},
				{Name: "PROJECT_ID", Value: pe.Spec.ProjectID},
				{Name: "IDLE_TIMEOUT_SECONDS", Value: fmt.Sprintf("%d", pe.Spec.IdleTimeoutSeconds)},
				{Name: "WORKSPACE_PATH", Value: "/workspace"},
				{Name: "HOME_PATH", Value: "/home/agent"},
				{Name: "CORS_ORIGIN", Value: "https://" + cfg.GatewayHostname},
				{Name: "METRICS_TOKEN", Value: cfg.MetricsToken},
			},
			VolumeMounts: []corev1.VolumeMount{
				{Name: "data", MountPath: "/workspace", SubPath: "workspace"},
				{Name: "data", MountPath: "/home/agent", SubPath: "home"},
				{Name: "tmp", MountPath: "/tmp"},
			},
			ReadinessProbe: &corev1.Probe{
				ProbeHandler: corev1.ProbeHandler{
					HTTPGet: &corev1.HTTPGetAction{
						Path: "/health",
						Port: intstr.FromInt(8080),
					},
				},
				InitialDelaySeconds: 2,
				PeriodSeconds:       5,
			},
			SecurityContext: &corev1.SecurityContext{
				AllowPrivilegeEscalation: boolPtr(false),
				ReadOnlyRootFilesystem:   boolPtr(true),
				Capabilities:             &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
			},
		},
	}

	volumes := []corev1.Volume{
		{
			Name: "data",
			VolumeSource: corev1.VolumeSource{
				PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
					ClaimName: pvcName(pe),
				},
			},
		},
		{Name: "tmp", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}},
	}

	// When the namespace has registry credentials, mount them as a read-only
	// dockerconfigjson so buildah/skopeo pick them up via REGISTRY_AUTH_FILE.
	// The volume is optional so the pod still starts if the Secret lags behind.
	if pe.Spec.RegistryAuth != nil {
		containers[0].Env = append(containers[0].Env,
			corev1.EnvVar{Name: "REGISTRY_AUTH_FILE", Value: "/etc/registry-auth/.dockerconfigjson"},
			corev1.EnvVar{Name: "DOCKER_CONFIG", Value: "/etc/registry-auth"},
			corev1.EnvVar{Name: "REGISTRY_HOST", Value: pe.Spec.RegistryAuth.Server},
		)
		if cfg.RegistryInsecure != "" {
			containers[0].Env = append(containers[0].Env,
				corev1.EnvVar{Name: "REGISTRY_INSECURE", Value: cfg.RegistryInsecure})
		}
		containers[0].VolumeMounts = append(containers[0].VolumeMounts, corev1.VolumeMount{
			Name:      "registry-auth",
			MountPath: "/etc/registry-auth",
			ReadOnly:  true,
		})
		volumes = append(volumes, corev1.Volume{
			Name: "registry-auth",
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{
					SecretName: registrySecretName,
					Optional:   boolPtr(true),
				},
			},
		})
	}

	podLabels := projectLabels(pe)
	podLabels["app"] = name

	// Mount the project SA when kube deploy access is enabled; otherwise block
	// all SA token automounting so the agent has no cluster API access by default.
	automount := boolPtr(pe.Spec.KubeDeployAccess)
	serviceAccountName := ""
	if pe.Spec.KubeDeployAccess {
		serviceAccountName = projectSAName
	}

	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
			Labels:    labels,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Strategy: appsv1.DeploymentStrategy{
				Type: appsv1.RecreateDeploymentStrategyType,
			},
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{LabelProjectID: pe.Spec.ProjectID},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: podLabels},
				Spec: corev1.PodSpec{
					Hostname:                     pe.Spec.ProjectSlug,
					ServiceAccountName:           serviceAccountName,
					AutomountServiceAccountToken: automount,
					SecurityContext: &corev1.PodSecurityContext{
						RunAsNonRoot: boolPtr(true),
						RunAsUser:    int64Ptr(1000),
						FSGroup:      int64Ptr(1000),
					},
					Containers: containers,
					Volumes:    volumes,
				},
			},
		},
	}
}

func buildService(pe *v1alpha1.ProjectEnvironment) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      serviceName(pe),
			Namespace: projectNamespace(pe),
			Labels:    projectLabels(pe),
		},
		Spec: corev1.ServiceSpec{
			Type:     corev1.ServiceTypeClusterIP,
			Selector: map[string]string{LabelProjectID: pe.Spec.ProjectID},
			Ports: []corev1.ServicePort{
				{Port: 8080, TargetPort: intstr.FromInt(8080), Protocol: corev1.ProtocolTCP},
			},
		},
	}
}

func buildNetworkPolicy(pe *v1alpha1.ProjectEnvironment, cfg *Config) *networkingv1.NetworkPolicy {
	egress := []networkingv1.NetworkPolicyEgressRule{
		// Always allow DNS.
		{
			Ports: []networkingv1.NetworkPolicyPort{
				{Port: intstrPtr(53), Protocol: protocolPtr(corev1.ProtocolUDP)},
				{Port: intstrPtr(53), Protocol: protocolPtr(corev1.ProtocolTCP)},
			},
		},
		// Allow egress to the web app (for JWKS).
		{
			To: []networkingv1.NetworkPolicyPeer{
				{
					NamespaceSelector: &metav1.LabelSelector{
						MatchLabels: map[string]string{"kubernetes.io/metadata.name": cfg.Namespace},
					},
				},
			},
		},
	}

	// Allow egress to Harbor so in-pod builds can push/pull images.
	if cfg.HarborNamespace != "" {
		egress = append(egress, networkingv1.NetworkPolicyEgressRule{
			To: []networkingv1.NetworkPolicyPeer{
				{
					NamespaceSelector: &metav1.LabelSelector{
						MatchLabels: map[string]string{"kubernetes.io/metadata.name": cfg.HarborNamespace},
					},
				},
			},
		})
	}

	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      networkPolicyName(pe),
			Namespace: projectNamespace(pe),
			Labels:    projectLabels(pe),
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{
				MatchLabels: map[string]string{LabelProjectID: pe.Spec.ProjectID},
			},
			PolicyTypes: []networkingv1.PolicyType{
				networkingv1.PolicyTypeIngress,
				networkingv1.PolicyTypeEgress,
			},
			Ingress: []networkingv1.NetworkPolicyIngressRule{
				// Allow all ingress on 8080. The Envoy Gateway proxy runs with hostNetwork
				// so its source is the node IP (10.244.0.1), not a pod namespace IP —
				// namespaceSelector cannot restrict it. /api/* routes are JWT-gated by the
				// agent; /metrics and /health are unreachable via the gateway because the
				// HTTPRoute only rewrites and forwards /api/* paths.
				{
					Ports: []networkingv1.NetworkPolicyPort{
						{Port: intstrPtr(8080), Protocol: protocolPtr(corev1.ProtocolTCP)},
					},
				},
			},
			Egress: egress,
		},
	}
}

// buildHTTPRoute returns the unstructured map for a Gateway API HTTPRoute.
// We use map[string]interface{} since HTTPRoute is a CRD not in k8s.io/api.
func buildHTTPRoute(pe *v1alpha1.ProjectEnvironment, cfg *Config) map[string]interface{} {
	pathPrefix := fmt.Sprintf("/env/%s/%s", pe.Spec.NamespaceSlug, pe.Spec.ProjectSlug)
	labels := projectLabels(pe)

	route := map[string]interface{}{
		"apiVersion": "gateway.networking.k8s.io/v1",
		"kind":       "HTTPRoute",
		"metadata": map[string]interface{}{
			"name":      routeName(pe),
			"namespace": projectNamespace(pe),
			"labels":    labelsToInterface(labels),
		},
		"spec": map[string]interface{}{
			"parentRefs": []interface{}{
				map[string]interface{}{
					"name":        cfg.GatewayName,
					"namespace":   cfg.GatewayNamespace,
					"sectionName": cfg.gatewayListenerHTTPS(),
				},
			},
			"hostnames": []interface{}{cfg.GatewayHostname},
			"rules": []interface{}{
				map[string]interface{}{
					"matches": []interface{}{
						map[string]interface{}{
							"path": map[string]interface{}{
								"type":  "PathPrefix",
								"value": pathPrefix,
							},
						},
					},
					"filters": []interface{}{
						map[string]interface{}{
							"type": "URLRewrite",
							"urlRewrite": map[string]interface{}{
								"path": map[string]interface{}{
									"type":               "ReplacePrefixMatch",
									"replacePrefixMatch": "/api",
								},
							},
						},
					},
					"backendRefs": []interface{}{
						map[string]interface{}{
							"name":      serviceName(pe),
							"namespace": projectNamespace(pe),
							"port":      int64(8080),
						},
					},
				},
			},
		},
	}

	if cfg.GatewayHostname == "" {
		delete(route["spec"].(map[string]interface{}), "hostnames")
	}

	return route
}

// buildCiliumNetworkPolicy returns the unstructured map for a CiliumNetworkPolicy.
// When egress filtering is disabled, allows all non-RFC1918 egress (internet access).
// When egress filtering is enabled, restricts egress to the declared FQDN allow-rules.
func buildCiliumNetworkPolicy(pe *v1alpha1.ProjectEnvironment) map[string]interface{} {
	labels := projectLabels(pe)

	var egressRules []interface{}

	if !pe.Spec.EgressPolicy.Enabled {
		// Allow internet (non-RFC1918) egress while blocking private address space.
		egressRules = []interface{}{
			map[string]interface{}{
				"toCIDRSet": []interface{}{
					map[string]interface{}{
						"cidr": "0.0.0.0/0",
						"except": []interface{}{
							"10.0.0.0/8",
							"172.16.0.0/12",
							"192.168.0.0/16",
							"127.0.0.0/8",
							"169.254.0.0/16",
						},
					},
				},
			},
		}
	} else {
		egressRules = []interface{}{}
		for _, rule := range pe.Spec.EgressPolicy.Rules {
			if rule.RuleType != "allow" {
				continue
			}
			ports := []interface{}{}
			for _, p := range rule.Ports {
				ports = append(ports, map[string]interface{}{"port": fmt.Sprintf("%d", p)})
			}
			egressRules = append(egressRules, map[string]interface{}{
				"toFQDNs": []interface{}{
					map[string]interface{}{"matchName": rule.Domain},
				},
				"toPorts": []interface{}{
					map[string]interface{}{"ports": ports},
				},
			})
		}
	}

	return map[string]interface{}{
		"apiVersion": "cilium.io/v2",
		"kind":       "CiliumNetworkPolicy",
		"metadata": map[string]interface{}{
			"name":      ciliumPolicyName(pe),
			"namespace": projectNamespace(pe),
			"labels":    labelsToInterface(labels),
		},
		"spec": map[string]interface{}{
			"endpointSelector": map[string]interface{}{
				"matchLabels": map[string]interface{}{
					LabelProjectID: pe.Spec.ProjectID,
				},
			},
			"egress": egressRules,
		},
	}
}

func labelsToInterface(m map[string]string) map[string]interface{} {
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func buildProjectServiceAccount(pe *v1alpha1.ProjectEnvironment) *corev1.ServiceAccount {
	return &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      projectSAName,
			Namespace: projectNamespace(pe),
			Labels:    projectLabels(pe),
		},
	}
}

func buildProjectRole(pe *v1alpha1.ProjectEnvironment) *rbacv1.Role {
	return &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:      projectRoleName,
			Namespace: projectNamespace(pe),
			Labels:    projectLabels(pe),
		},
		Rules: []rbacv1.PolicyRule{
			{
				APIGroups: []string{"apps"},
				Resources: []string{"deployments", "statefulsets"},
				Verbs:     []string{"get", "list", "watch", "create", "update", "patch", "delete"},
			},
			{
				APIGroups: []string{""},
				Resources: []string{"services"},
				Verbs:     []string{"get", "list", "watch", "create", "update", "patch", "delete"},
			},
		},
	}
}

func buildProjectRoleBinding(pe *v1alpha1.ProjectEnvironment) *rbacv1.RoleBinding {
	return &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      projectRoleName,
			Namespace: projectNamespace(pe),
			Labels:    projectLabels(pe),
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "Role",
			Name:     projectRoleName,
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      projectSAName,
				Namespace: projectNamespace(pe),
			},
		},
	}
}

func boolPtr(b bool) *bool                           { return &b }
func int64Ptr(i int64) *int64                        { return &i }
func intstrPtr(i int) *intstr.IntOrString            { v := intstr.FromInt(i); return &v }
func protocolPtr(p corev1.Protocol) *corev1.Protocol { return &p }
