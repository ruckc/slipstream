package controller

import "slipstream/project-controller/api/v1alpha1"

const (
	LabelOwnerNamespaceID   = "slipstream.io/owner-namespace-id"
	LabelOwnerNamespaceSlug = "slipstream.io/owner-namespace-slug"
	LabelProjectID          = "slipstream.io/project-id"
	LabelProjectSlug        = "slipstream.io/project-slug"

	FinalizerName = "slipstream.io/project-environment"
)

func projectLabels(pe *v1alpha1.ProjectEnvironment) map[string]string {
	return map[string]string{
		LabelOwnerNamespaceID:   pe.Spec.NamespaceID,
		LabelOwnerNamespaceSlug: pe.Spec.NamespaceSlug,
		LabelProjectID:          pe.Spec.ProjectID,
		LabelProjectSlug:        pe.Spec.ProjectSlug,
	}
}
