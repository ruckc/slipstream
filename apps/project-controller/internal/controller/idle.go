package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/klog/v2"
)

// queryLastActivityAt queries VictoriaMetrics for slipstream_last_activity_at
// and returns a map of projectId → last activity unix timestamp.
func queryLastActivityAt(ctx context.Context, pushURL string) (map[string]float64, error) {
	queryURL := strings.TrimRight(pushURL, "/") + "/api/v1/query"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, queryURL, nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("query", "slipstream_last_activity_at")
	req.URL.RawQuery = q.Encode()

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("VictoriaMetrics query returned %d", resp.StatusCode)
	}

	var result struct {
		Data struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
				Value  [2]interface{}    `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	out := make(map[string]float64)
	for _, r := range result.Data.Result {
		projectID := r.Metric["project_id"]
		if projectID == "" {
			continue
		}
		valStr, ok := r.Value[1].(string)
		if !ok {
			continue
		}
		val, err := strconv.ParseFloat(valStr, 64)
		if err != nil {
			continue
		}
		out[projectID] = val
	}
	return out, nil
}

// checkIdleProjects queries VictoriaMetrics and returns project IDs that should
// be scaled down due to idleness. The controller calls this on its resync interval.
func (c *Controller) checkIdleProjects(ctx context.Context) {
	if c.cfg.MetricsPushURL == "" {
		return
	}

	activity, err := queryLastActivityAt(ctx, c.cfg.MetricsPushURL)
	if err != nil {
		klog.Errorf("idle check: failed to query VictoriaMetrics: %v", err)
		return
	}

	now := float64(time.Now().Unix())

	// List all ProjectEnvironments with desiredState=running.
	rawList, err := c.peClient.List(ctx, metav1.ListOptions{})
	if err != nil {
		klog.Errorf("idle check: failed to list ProjectEnvironments: %v", err)
		return
	}

	for i := range rawList.Items {
		pe, err := unstructuredToPE(&rawList.Items[i])
		if err != nil {
			continue
		}
		if pe.Spec.DesiredState != "running" {
			continue
		}
		lastActivity, ok := activity[pe.Spec.ProjectID]
		if !ok {
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
