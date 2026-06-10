package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"slipstream/project-controller/api/v1alpha1"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/runtime"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/workqueue"
	"k8s.io/klog/v2"
)

var projectEnvGVR = schema.GroupVersionResource{
	Group:    "slipstream.io",
	Version:  "v1alpha1",
	Resource: "projectenvironments",
}

const (
	resyncPeriod  = 10 * time.Minute
	idleCheckFreq = 60 * time.Second
	workers       = 2
)

type Controller struct {
	cfg        *Config
	kubeclient kubernetes.Interface
	dynClient  dynamic.Interface
	peClient   dynamic.NamespaceableResourceInterface
	queue      workqueue.RateLimitingInterface
	informer   cache.SharedIndexInformer
}

func New(cfg *Config, kubeclient kubernetes.Interface, dynClient dynamic.Interface) *Controller {
	factory := dynamicinformer.NewFilteredDynamicSharedInformerFactory(dynClient, resyncPeriod, metav1.NamespaceAll, nil)
	informer := factory.ForResource(projectEnvGVR).Informer()

	queue := workqueue.NewRateLimitingQueue(workqueue.DefaultControllerRateLimiter())

	c := &Controller{
		cfg:        cfg,
		kubeclient: kubeclient,
		dynClient:  dynClient,
		peClient:   dynClient.Resource(projectEnvGVR),
		queue:      queue,
		informer:   informer,
	}

	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { c.enqueue(obj) },
		UpdateFunc: func(_, obj interface{}) { c.enqueue(obj) },
		DeleteFunc: func(obj interface{}) { c.enqueue(obj) },
	})

	return c
}

func (c *Controller) Run(ctx context.Context) {
	defer runtime.HandleCrash()
	defer c.queue.ShutDown()

	klog.Info("Starting project-controller")

	go c.informer.Run(ctx.Done())

	if !cache.WaitForCacheSync(ctx.Done(), c.informer.HasSynced) {
		runtime.HandleError(fmt.Errorf("timed out waiting for cache sync"))
		return
	}

	for i := 0; i < workers; i++ {
		go wait.UntilWithContext(ctx, c.runWorker, time.Second)
	}

	// Idle detection loop.
	go wait.UntilWithContext(ctx, func(ctx context.Context) {
		c.checkIdleProjects(ctx)
	}, idleCheckFreq)

	<-ctx.Done()
	klog.Info("Shutting down project-controller")
}

func (c *Controller) enqueue(obj interface{}) {
	key, err := cache.MetaNamespaceKeyFunc(obj)
	if err != nil {
		runtime.HandleError(err)
		return
	}
	c.queue.Add(key)
}

func (c *Controller) runWorker(ctx context.Context) {
	for c.processNext(ctx) {
	}
}

func (c *Controller) processNext(ctx context.Context) bool {
	key, quit := c.queue.Get()
	if quit {
		return false
	}
	defer c.queue.Done(key)

	err := c.reconcile(ctx, key.(string))
	if err == nil {
		c.queue.Forget(key)
		return true
	}

	runtime.HandleError(fmt.Errorf("reconcile %q failed: %w", key, err))
	c.queue.AddRateLimited(key)
	return true
}

func (c *Controller) reconcile(ctx context.Context, key string) error {
	_, name, err := cache.SplitMetaNamespaceKey(key)
	if err != nil {
		return err
	}

	raw, err := c.peClient.Get(ctx, name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		// Already deleted; GC handles namespace via ownerReference on the Namespace.
		return nil
	}
	if err != nil {
		return err
	}

	pe, err := unstructuredToPE(raw)
	if err != nil {
		return err
	}

	// Handle deletion via finalizer.
	if !pe.DeletionTimestamp.IsZero() {
		return c.handleDelete(ctx, pe)
	}

	// Ensure finalizer is present.
	if err := c.ensureFinalizer(ctx, pe); err != nil {
		return err
	}

	return c.ensureResources(ctx, pe)
}

func (c *Controller) handleDelete(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	ns := projectNamespace(pe)

	if !pe.Spec.RetainStorage {
		// Delete PVC explicitly before the namespace deletion.
		err := c.kubeclient.CoreV1().PersistentVolumeClaims(ns).Delete(ctx, pvcName(pe), metav1.DeleteOptions{})
		if err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("delete PVC: %w", err)
		}
	}

	// Delete namespace (cascades all resources inside).
	err := c.kubeclient.CoreV1().Namespaces().Delete(ctx, ns, metav1.DeleteOptions{})
	if err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("delete namespace: %w", err)
	}

	return c.removeFinalizer(ctx, pe)
}

func (c *Controller) ensureResources(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	if err := c.ensureNamespace(ctx, pe); err != nil {
		return fmt.Errorf("ensure namespace: %w", err)
	}
	if err := c.ensurePVC(ctx, pe); err != nil {
		return fmt.Errorf("ensure PVC: %w", err)
	}
	if err := c.ensureDeployment(ctx, pe); err != nil {
		return fmt.Errorf("ensure deployment: %w", err)
	}
	if err := c.ensureService(ctx, pe); err != nil {
		return fmt.Errorf("ensure service: %w", err)
	}
	if err := c.ensureNetworkPolicy(ctx, pe); err != nil {
		return fmt.Errorf("ensure network policy: %w", err)
	}
	if err := c.ensureHTTPRoute(ctx, pe); err != nil {
		return fmt.Errorf("ensure HTTPRoute: %w", err)
	}
	if err := c.ensureCiliumPolicy(ctx, pe); err != nil {
		return fmt.Errorf("ensure CiliumNetworkPolicy: %w", err)
	}
	return c.updateStatus(ctx, pe)
}

// --- Namespace ---

func (c *Controller) ensureNamespace(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	desired := buildNamespace(pe)
	_, err := c.kubeclient.CoreV1().Namespaces().Get(ctx, desired.Name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = c.kubeclient.CoreV1().Namespaces().Create(ctx, desired, metav1.CreateOptions{})
	}
	return err
}

// --- PVC ---

func (c *Controller) ensurePVC(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	ns := projectNamespace(pe)
	name := pvcName(pe)
	_, err := c.kubeclient.CoreV1().PersistentVolumeClaims(ns).Get(ctx, name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		desired := buildPVC(pe, "")
		_, err = c.kubeclient.CoreV1().PersistentVolumeClaims(ns).Create(ctx, desired, metav1.CreateOptions{})
	}
	return err
}

// --- Deployment ---

func (c *Controller) ensureDeployment(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	ns := projectNamespace(pe)
	desired := buildDeployment(pe, c.cfg)
	existing, err := c.kubeclient.AppsV1().Deployments(ns).Get(ctx, desired.Name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = c.kubeclient.AppsV1().Deployments(ns).Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	if err != nil {
		return err
	}

	// Update replicas and container spec; preserve resourceVersion.
	updated := existing.DeepCopy()
	updated.Spec.Replicas = desired.Spec.Replicas
	updated.Spec.Template.Spec.Containers = desired.Spec.Template.Spec.Containers
	updated.Labels = desired.Labels
	_, err = c.kubeclient.AppsV1().Deployments(ns).Update(ctx, updated, metav1.UpdateOptions{})
	return err
}

// --- Service ---

func (c *Controller) ensureService(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	ns := projectNamespace(pe)
	desired := buildService(pe)
	_, err := c.kubeclient.CoreV1().Services(ns).Get(ctx, desired.Name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = c.kubeclient.CoreV1().Services(ns).Create(ctx, desired, metav1.CreateOptions{})
	}
	return err
}

// --- NetworkPolicy ---

func (c *Controller) ensureNetworkPolicy(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	ns := projectNamespace(pe)
	desired := buildNetworkPolicy(pe)
	_, err := c.kubeclient.NetworkingV1().NetworkPolicies(ns).Get(ctx, desired.Name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = c.kubeclient.NetworkingV1().NetworkPolicies(ns).Create(ctx, desired, metav1.CreateOptions{})
	}
	return err
}

// --- HTTPRoute (dynamic client for Gateway API CRD) ---

var httpRouteGVR = schema.GroupVersionResource{
	Group:    "gateway.networking.k8s.io",
	Version:  "v1",
	Resource: "httproutes",
}

func (c *Controller) ensureHTTPRoute(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	ns := projectNamespace(pe)
	name := routeName(pe)
	desired := buildHTTPRoute(pe, c.cfg)

	_, err := c.dynClient.Resource(httpRouteGVR).Namespace(ns).Get(ctx, name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		obj := &unstructured.Unstructured{Object: desired}
		_, err = c.dynClient.Resource(httpRouteGVR).Namespace(ns).Create(ctx, obj, metav1.CreateOptions{})
	}
	return err
}

// --- CiliumNetworkPolicy (dynamic client for Cilium CRD) ---

var ciliumPolicyGVR = schema.GroupVersionResource{
	Group:    "cilium.io",
	Version:  "v2",
	Resource: "ciliumnetworkpolicies",
}

func (c *Controller) ensureCiliumPolicy(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	ns := projectNamespace(pe)
	name := ciliumPolicyName(pe)

	if !pe.Spec.EgressPolicy.Enabled {
		// Delete if it exists and egress is now disabled.
		err := c.dynClient.Resource(ciliumPolicyGVR).Namespace(ns).Delete(ctx, name, metav1.DeleteOptions{})
		if err != nil && !errors.IsNotFound(err) {
			return err
		}
		return nil
	}

	desired := buildCiliumNetworkPolicy(pe)
	existing, err := c.dynClient.Resource(ciliumPolicyGVR).Namespace(ns).Get(ctx, name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		obj := &unstructured.Unstructured{Object: desired}
		_, err = c.dynClient.Resource(ciliumPolicyGVR).Namespace(ns).Create(ctx, obj, metav1.CreateOptions{})
		return err
	}
	if err != nil {
		return err
	}

	// Replace spec on update.
	updated := existing.DeepCopy()
	updated.Object["spec"] = desired["spec"]
	_, err = c.dynClient.Resource(ciliumPolicyGVR).Namespace(ns).Update(ctx, updated, metav1.UpdateOptions{})
	return err
}

// --- Status ---

func (c *Controller) updateStatus(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	ns := projectNamespace(pe)
	phase := v1alpha1.PhaseStopped

	dep, err := c.kubeclient.AppsV1().Deployments(ns).Get(ctx, deploymentName(pe), metav1.GetOptions{})
	if err != nil && !errors.IsNotFound(err) {
		return err
	}

	podIP := ""
	if err == nil {
		phase, podIP = deploymentPhase(dep)
		if podIP == "" && phase == v1alpha1.PhaseRunning {
			// Look up pod IP.
			pods, err := c.kubeclient.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{
				LabelSelector: LabelProjectID + "=" + pe.Spec.ProjectID,
			})
			if err == nil {
				for _, pod := range pods.Items {
					if pod.Status.Phase == corev1.PodRunning && pod.Status.PodIP != "" {
						podIP = pod.Status.PodIP
						break
					}
				}
			}
		}
	}

	status := v1alpha1.ProjectEnvironmentStatus{
		Phase:              phase,
		PodIP:              podIP,
		ObservedGeneration: pe.Generation,
	}

	statusMap, err := toMap(status)
	if err != nil {
		return err
	}
	patchBytes, err := json.Marshal(map[string]interface{}{"status": statusMap})
	if err != nil {
		return err
	}
	_, err = c.peClient.Patch(ctx, pe.Name, "application/merge-patch+json", patchBytes, metav1.PatchOptions{}, "status")
	return err
}

func deploymentPhase(dep *appsv1.Deployment) (v1alpha1.ProjectEnvironmentPhase, string) {
	desired := int32(0)
	if dep.Spec.Replicas != nil {
		desired = *dep.Spec.Replicas
	}
	ready := dep.Status.ReadyReplicas

	switch {
	case desired == 0 && ready == 0:
		return v1alpha1.PhaseStopped, ""
	case desired == 0 && ready > 0:
		return v1alpha1.PhaseStopping, ""
	case desired > 0 && ready == 0:
		return v1alpha1.PhaseProvisioning, ""
	default:
		return v1alpha1.PhaseRunning, ""
	}
}

// --- Finalizer helpers ---

func (c *Controller) ensureFinalizer(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	for _, f := range pe.Finalizers {
		if f == FinalizerName {
			return nil
		}
	}
	patch := fmt.Sprintf(`{"metadata":{"finalizers":[%q]}}`, FinalizerName)
	_, err := c.peClient.Patch(ctx, pe.Name, "application/merge-patch+json", []byte(patch), metav1.PatchOptions{})
	return err
}

func (c *Controller) removeFinalizer(ctx context.Context, pe *v1alpha1.ProjectEnvironment) error {
	remaining := []string{}
	for _, f := range pe.Finalizers {
		if f != FinalizerName {
			remaining = append(remaining, f)
		}
	}
	b, _ := json.Marshal(remaining)
	patch := fmt.Sprintf(`{"metadata":{"finalizers":%s}}`, b)
	_, err := c.peClient.Patch(ctx, pe.Name, "application/merge-patch+json", []byte(patch), metav1.PatchOptions{})
	return err
}

func (c *Controller) patchDesiredState(ctx context.Context, name, state string) error {
	patch := fmt.Sprintf(`{"spec":{"desiredState":%q}}`, state)
	_, err := c.peClient.Patch(ctx, name, "application/merge-patch+json", []byte(patch), metav1.PatchOptions{})
	return err
}

// --- Unstructured conversion ---

func unstructuredToPE(u *unstructured.Unstructured) (*v1alpha1.ProjectEnvironment, error) {
	data, err := json.Marshal(u.Object)
	if err != nil {
		return nil, err
	}
	var pe v1alpha1.ProjectEnvironment
	if err := json.Unmarshal(data, &pe); err != nil {
		return nil, err
	}
	return &pe, nil
}

func toMap(v interface{}) (map[string]interface{}, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return m, nil
}
