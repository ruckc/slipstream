package controller

import (
	"fmt"

	"slipstream/project-controller/api/v1alpha1"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
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

func desiredReplicas(pe *v1alpha1.ProjectEnvironment) int32 {
	if pe.Spec.DesiredState == "running" {
		return 1
	}
	return 0
}

func buildNamespace(pe *v1alpha1.ProjectEnvironment) *corev1.Namespace {
	labels := projectLabels(pe)
	labels["slipstream.io/managed"] = "true"
	return &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:   projectNamespace(pe),
			Labels: labels,
		},
	}
}

func buildPVC(pe *v1alpha1.ProjectEnvironment, storageClass string) *corev1.PersistentVolumeClaim {
	sc := storageClass
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
					corev1.ResourceStorage: resource.MustParse("10Gi"),
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
				{Name: "CORS_ORIGIN", Value: "https://" + cfg.GatewayHostname},
			},
			VolumeMounts: []corev1.VolumeMount{
				{Name: "workspace", MountPath: "/workspace"},
				{Name: "tmp", MountPath: "/tmp"},
				{Name: "home", MountPath: "/home/agent"},
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

	if cfg.MetricsSidecarImage != "" {
		containers = append(containers, corev1.Container{
			Name:  "metrics-sidecar",
			Image: cfg.MetricsSidecarImage,
			Env: []corev1.EnvVar{
				{Name: "PROJECT_ID", Value: pe.Spec.ProjectID},
				{Name: "PUSH_URL", Value: cfg.MetricsPushURL},
			},
			SecurityContext: &corev1.SecurityContext{
				AllowPrivilegeEscalation: boolPtr(false),
				Capabilities:             &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
			},
		})
	}

	podLabels := projectLabels(pe)
	podLabels["app"] = name

	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
			Labels:    labels,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{LabelProjectID: pe.Spec.ProjectID},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: podLabels},
				Spec: corev1.PodSpec{
					Hostname:                     pe.Spec.ProjectSlug,
					AutomountServiceAccountToken: boolPtr(false),
					SecurityContext: &corev1.PodSecurityContext{
						RunAsNonRoot: boolPtr(true),
						RunAsUser:    int64Ptr(1000),
						FSGroup:      int64Ptr(1000),
					},
					Containers: containers,
					Volumes: []corev1.Volume{
						{
							Name: "workspace",
							VolumeSource: corev1.VolumeSource{
								PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
									ClaimName: pvcName(pe),
								},
							},
						},
						{Name: "tmp", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}},
						{Name: "home", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}},
					},
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

func buildNetworkPolicy(pe *v1alpha1.ProjectEnvironment) *networkingv1.NetworkPolicy {
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
				// Allow ingress from the gateway namespace only.
				{
					From: []networkingv1.NetworkPolicyPeer{
						{
							NamespaceSelector: &metav1.LabelSelector{
								MatchLabels: map[string]string{"kubernetes.io/metadata.name": "slipstream-system"},
							},
						},
					},
				},
			},
			Egress: []networkingv1.NetworkPolicyEgressRule{
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
								MatchLabels: map[string]string{"kubernetes.io/metadata.name": "slipstream-system"},
							},
						},
					},
				},
			},
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
									"replacePrefixMatch": "/",
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
// Only called when pe.Spec.EgressPolicy.Enabled is true.
func buildCiliumNetworkPolicy(pe *v1alpha1.ProjectEnvironment) map[string]interface{} {
	labels := projectLabels(pe)

	egressRules := []interface{}{}
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

func boolPtr(b bool) *bool         { return &b }
func int64Ptr(i int64) *int64      { return &i }
func intstrPtr(i int) *intstr.IntOrString { v := intstr.FromInt(i); return &v }
func protocolPtr(p corev1.Protocol) *corev1.Protocol { return &p }
