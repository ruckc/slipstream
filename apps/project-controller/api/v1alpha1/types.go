// +groupName=slipstream.io

package v1alpha1

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

// +genclient
// +genclient:nonNamespaced
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object
// +kubebuilder:resource:scope=Cluster

// ProjectEnvironment is a cluster-scoped resource representing a Slipstream
// project's desired cluster state. The controller owns all child resources
// (Namespace, Deployment, Service, HTTPRoute, NetworkPolicy, CiliumNetworkPolicy,
// PVC) and reconciles them against this spec.
type ProjectEnvironment struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   ProjectEnvironmentSpec   `json:"spec"`
	Status ProjectEnvironmentStatus `json:"status,omitempty"`
}

type ProjectEnvironmentSpec struct {
	// ProjectID is the DB UUID of the project.
	ProjectID string `json:"projectId"`

	// NamespaceID is the DB UUID of the owning namespace (user or org).
	NamespaceID string `json:"namespaceId"`

	// NamespaceSlug is the human-readable slug of the owning namespace.
	// +kubebuilder:validation:MinLength=1
	NamespaceSlug string `json:"namespaceSlug"`

	// ProjectSlug is the human-readable slug of the project.
	// +kubebuilder:validation:MinLength=1
	ProjectSlug string `json:"projectSlug"`

	// DesiredState controls whether the project's Deployment is running or stopped.
	// +kubebuilder:validation:Enum=running;stopped
	DesiredState string `json:"desiredState"`

	// IdleTimeoutSeconds is the resolved idle timeout for this project.
	// The web app writes the fully resolved value (project → org/user → default).
	// The controller scales the Deployment to 0 when last_activity_at is older
	// than this threshold.
	IdleTimeoutSeconds int `json:"idleTimeoutSeconds"`

	// RetainStorage controls whether the PVC is deleted when the CR is deleted.
	// Defaults to true (PVC is kept).
	// +kubebuilder:default=true
	RetainStorage bool `json:"retainStorage"`

	// EgressPolicy describes the desired network egress configuration.
	EgressPolicy EgressPolicySpec `json:"egressPolicy"`

	// KubeDeployAccess controls whether the agent pod is granted a ServiceAccount
	// with permission to manage Deployments, StatefulSets, and Services within its
	// own project namespace.
	// +kubebuilder:default=false
	KubeDeployAccess bool `json:"kubeDeployAccess"`
}

type EgressPolicySpec struct {
	// Enabled controls whether a CiliumNetworkPolicy egress filter is applied.
	Enabled bool `json:"enabled"`

	// Rules is the resolved list of egress rules for this project.
	Rules []EgressRule `json:"rules,omitempty"`
}

type EgressRule struct {
	// Domain is the target domain, e.g. "api.github.com" or "*.github.com".
	Domain string `json:"domain"`

	// Ports is the list of allowed ports.
	Ports []int32 `json:"ports"`

	// RuleType is "allow" or "deny".
	// +kubebuilder:validation:Enum=allow;deny
	RuleType string `json:"ruleType"`
}

// ProjectEnvironmentPhase represents the observed lifecycle phase.
// +kubebuilder:validation:Enum=Pending;Provisioning;Running;Stopping;Stopped;Error
type ProjectEnvironmentPhase string

const (
	PhasePending      ProjectEnvironmentPhase = "Pending"
	PhaseProvisioning ProjectEnvironmentPhase = "Provisioning"
	PhaseRunning      ProjectEnvironmentPhase = "Running"
	PhaseStopping     ProjectEnvironmentPhase = "Stopping"
	PhaseStopped      ProjectEnvironmentPhase = "Stopped"
	PhaseError        ProjectEnvironmentPhase = "Error"
)

type ProjectEnvironmentStatus struct {
	// Phase is the high-level lifecycle state.
	Phase ProjectEnvironmentPhase `json:"phase,omitempty"`

	// PodIP is the IP of the running agent pod, set when phase is Running.
	PodIP string `json:"podIP,omitempty"`

	// ObservedGeneration is the .metadata.generation the controller last reconciled.
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`

	// Conditions is a list of standard k8s conditions.
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// ProjectEnvironmentList is a list of ProjectEnvironment resources.
type ProjectEnvironmentList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata"`

	Items []ProjectEnvironment `json:"items"`
}
