package controller

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/klog/v2"
)

// scrapeLastActivityAt fetches /metrics from a running agent pod and returns
// the value of slipstream_last_activity_at. Returns an error if the pod is
// unreachable or the metric is absent — callers should skip the project.
func scrapeLastActivityAt(ctx context.Context, projectID string) (float64, error) {
	url := fmt.Sprintf(
		"http://svc-%s.project-%s.svc.cluster.local:8080/metrics",
		projectID, projectID,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("unexpected status %d from %s", resp.StatusCode, url)
	}

	scanner := bufio.NewScanner(resp.Body)
	prefix := fmt.Sprintf(`slipstream_last_activity_at{project_id="%s"}`, projectID)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "#") {
			continue
		}
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		return strconv.ParseFloat(fields[1], 64)
	}
	if err := scanner.Err(); err != nil {
		return 0, err
	}
	return 0, fmt.Errorf("slipstream_last_activity_at not found in metrics for project %s", projectID)
}

// checkIdleProjects scrapes /metrics on each running project pod and scales
// down any whose last activity exceeds the configured idle timeout.
func (c *Controller) checkIdleProjects(ctx context.Context) {
	rawList, err := c.peClient.List(ctx, metav1.ListOptions{})
	if err != nil {
		klog.Errorf("idle check: failed to list ProjectEnvironments: %v", err)
		return
	}

	now := float64(time.Now().Unix())

	for i := range rawList.Items {
		pe, err := unstructuredToPE(&rawList.Items[i])
		if err != nil {
			continue
		}
		if pe.Spec.DesiredState != "running" {
			continue
		}

		lastActivity, err := scrapeLastActivityAt(ctx, pe.Spec.ProjectID)
		if err != nil {
			// Pod not yet ready or unreachable — leave it alone this cycle.
			klog.V(4).Infof("idle check: skipping %s: %v", pe.Name, err)
			continue
		}

		if now-lastActivity < float64(pe.Spec.IdleTimeoutSeconds) {
			continue
		}

		klog.Infof("idle check: scaling down %s (idle for %.0fs)", pe.Name, now-lastActivity)
		if err := c.patchDesiredState(ctx, pe.Name, "stopped"); err != nil {
			klog.Errorf("idle check: failed to patch %s: %v", pe.Name, err)
		}
	}
}
