package controller

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	v1alpha1 "slipstream/project-controller/api/v1alpha1"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Per-namespace robot credentials are persisted in this Secret (in the
// controller's own namespace) because Harbor returns a robot secret only once.
// It is the source of truth for the namespace's Harbor robots — replacing the
// web app's namespace_registry DB table.
func harborCredsSecretName(slug string) string { return "harbor-creds-" + slug }

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

type registryCreds struct {
	robotName       string
	robotSecret     string
	pullRobotName   string
	pullRobotSecret string
}

// --- Harbor admin HTTP client -------------------------------------------------

type harborClient struct {
	baseURL    string
	authHeader string
	http       *http.Client
}

func newHarborClient(cfg *Config) *harborClient {
	cred := cfg.HarborAdminUsername + ":" + cfg.HarborAdminPassword
	return &harborClient{
		baseURL:    strings.TrimRight(cfg.HarborURL, "/"),
		authHeader: "Basic " + base64.StdEncoding.EncodeToString([]byte(cred)),
		http:       &http.Client{Timeout: 30 * time.Second},
	}
}

func (h *harborClient) do(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, h.baseURL+"/api/v2.0"+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", h.authHeader)
	req.Header.Set("Content-Type", "application/json")
	return h.http.Do(req)
}

// ensureProject creates a private Harbor project named after the slug. Idempotent.
func (h *harborClient) ensureProject(ctx context.Context, slug string) error {
	res, err := h.do(ctx, http.MethodPost, "/projects", map[string]interface{}{
		"project_name": slug,
		"metadata":     map[string]string{"public": "false"},
	})
	if err != nil {
		return err
	}
	defer res.Body.Close()
	// 201 created, 409 already exists — both fine.
	if res.StatusCode != http.StatusCreated && res.StatusCode != http.StatusConflict {
		return fmt.Errorf("harbor: create project %q: HTTP %d", slug, res.StatusCode)
	}
	return nil
}

// createRobot creates a project-scoped robot. When pullOnly is false it grants
// push+pull; otherwise pull-only. Returns the full robot login and its secret.
func (h *harborClient) createRobot(ctx context.Context, slug string, pullOnly bool) (string, string, error) {
	access := []map[string]string{
		{"resource": "repository", "action": "push"},
		{"resource": "repository", "action": "pull"},
	}
	name := "slipstream-" + slug
	desc := "Slipstream namespace push/pull robot"
	if pullOnly {
		access = []map[string]string{{"resource": "repository", "action": "pull"}}
		name = "slipstream-" + slug + "-pull"
		desc = "Slipstream namespace pull-only robot (workspace pods)"
	}
	res, err := h.do(ctx, http.MethodPost, "/robots", map[string]interface{}{
		"name":        name,
		"description": desc,
		"duration":    -1, // never expires
		"level":       "project",
		"permissions": []map[string]interface{}{
			{"kind": "project", "namespace": slug, "access": access},
		},
	})
	if err != nil {
		return "", "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		return "", "", fmt.Errorf("harbor: create robot %q: HTTP %d", name, res.StatusCode)
	}
	var body struct {
		Name   string `json:"name"`
		Secret string `json:"secret"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return "", "", fmt.Errorf("harbor: decode robot %q: %w", name, err)
	}
	if body.Name == "" || body.Secret == "" {
		return "", "", fmt.Errorf("harbor: robot %q response missing name/secret", name)
	}
	return body.Name, body.Secret, nil
}

// --- Reconcile: provision Harbor + materialize pod credentials ----------------

// ensureHarborRegistry provisions the namespace's Harbor project + robots (once
// per namespace, persisted in a controller-namespace Secret) and materializes
// the dockerconfigjson Secrets the agent (push+pull) and workspace pods
// (pull-only) consume. No-op when the registry isn't configured.
func (c *Controller) ensureHarborRegistry(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	if !c.cfg.registryEnabled() {
		return nil
	}
	slug := pe.Spec.NamespaceSlug
	if slug == "" {
		return nil
	}
	if !slugRe.MatchString(slug) {
		return fmt.Errorf("invalid namespace slug %q", slug)
	}

	creds, err := c.ensureNamespaceRobot(ctx, slug)
	if err != nil {
		return err
	}

	// push+pull credentials → agent pod (project namespace).
	if err := c.materializeRegistrySecret(
		ctx, projectNamespace(pe), registrySecretName, pe, creds.robotName, creds.robotSecret,
	); err != nil {
		return fmt.Errorf("materialize push/pull secret: %w", err)
	}

	// pull-only credentials → workspace pods (workspace namespace).
	if err := c.ensureWorkspaceNamespaceExists(ctx, pe); err != nil {
		return fmt.Errorf("ensure workspace namespace: %w", err)
	}
	if err := c.materializeRegistrySecret(
		ctx, workspaceNamespace(pe), registryPullSecretName, pe, creds.pullRobotName, creds.pullRobotSecret,
	); err != nil {
		return fmt.Errorf("materialize pull secret: %w", err)
	}
	return nil
}

// ensureNamespaceRobot returns the namespace's robot credentials, provisioning
// them in Harbor on first use. The controller-namespace Secret doubles as a
// provisioning lock: the reconcile that wins its creation provisions Harbor;
// concurrent reconciles for sibling projects requeue until it's populated.
func (c *Controller) ensureNamespaceRobot(ctx context.Context, slug string) (registryCreds, error) {
	name := harborCredsSecretName(slug)
	secrets := c.kubeclient.CoreV1().Secrets(c.cfg.Namespace)

	existing, err := secrets.Get(ctx, name, metav1.GetOptions{})
	if err == nil {
		if creds, ok := credsFromSecret(existing); ok {
			return creds, nil
		}
		// Present but not yet populated: another reconcile is provisioning.
		return registryCreds{}, fmt.Errorf("harbor registry provisioning in progress for %q", slug)
	}
	if !errors.IsNotFound(err) {
		return registryCreds{}, err
	}

	// Acquire the provisioning lock by creating a placeholder Secret atomically.
	lock := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: c.cfg.Namespace},
		Data:       map[string][]byte{"provisioning": []byte("true")},
	}
	if _, cerr := secrets.Create(ctx, lock, metav1.CreateOptions{}); cerr != nil {
		if errors.IsAlreadyExists(cerr) {
			return registryCreds{}, fmt.Errorf("harbor registry provisioning in progress for %q", slug)
		}
		return registryCreds{}, cerr
	}

	// We hold the lock — provision in Harbor.
	hc := newHarborClient(c.cfg)
	if err := hc.ensureProject(ctx, slug); err != nil {
		return registryCreds{}, err
	}
	rn, rs, err := hc.createRobot(ctx, slug, false)
	if err != nil {
		return registryCreds{}, err
	}
	pn, ps, err := hc.createRobot(ctx, slug, true)
	if err != nil {
		return registryCreds{}, err
	}
	creds := registryCreds{robotName: rn, robotSecret: rs, pullRobotName: pn, pullRobotSecret: ps}

	lock.Data = map[string][]byte{
		"robotName":       []byte(rn),
		"robotSecret":     []byte(rs),
		"pullRobotName":   []byte(pn),
		"pullRobotSecret": []byte(ps),
	}
	if _, err := secrets.Update(ctx, lock, metav1.UpdateOptions{}); err != nil {
		return registryCreds{}, fmt.Errorf("persist harbor creds: %w", err)
	}
	return creds, nil
}

func credsFromSecret(s *corev1.Secret) (registryCreds, bool) {
	rn := string(s.Data["robotName"])
	rs := string(s.Data["robotSecret"])
	pn := string(s.Data["pullRobotName"])
	ps := string(s.Data["pullRobotSecret"])
	if rn == "" || rs == "" || pn == "" || ps == "" {
		return registryCreds{}, false
	}
	return registryCreds{robotName: rn, robotSecret: rs, pullRobotName: pn, pullRobotSecret: ps}, true
}

// materializeRegistrySecret create-or-updates a dockerconfigjson Secret in the
// given namespace from the supplied robot credentials.
func (c *Controller) materializeRegistrySecret(
	ctx context.Context, namespace, name string, pe *v1alpha1.ProjectEnvironment, username, password string,
) error {
	desired := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			Labels:    projectLabels(pe),
		},
		Type: corev1.SecretTypeDockerConfigJson,
		Data: map[string][]byte{
			corev1.DockerConfigJsonKey: buildDockerConfigJSON(c.cfg.RegistryHost, username, password),
		},
	}
	secrets := c.kubeclient.CoreV1().Secrets(namespace)
	existing, err := secrets.Get(ctx, name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = secrets.Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	if err != nil {
		return err
	}
	existing.Type = desired.Type
	existing.Data = desired.Data
	_, err = secrets.Update(ctx, existing, metav1.UpdateOptions{})
	return err
}
