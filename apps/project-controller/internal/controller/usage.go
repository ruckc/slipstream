package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/klog/v2"
)

type usageSample struct {
	ProjectID string  `json:"projectId"`
	Metric    string  `json:"metric"`
	Value     float64 `json:"value"`
	SampledAt string  `json:"sampledAt"`
}

type usagePayload struct {
	Samples []usageSample `json:"samples"`
}

var usageMetrics = []struct {
	vmName string
	dbName string
}{
	{"slipstream_cpu_seconds_total", "cpu_seconds"},
	{"slipstream_memory_bytes", "memory_byte_seconds"},
	{"slipstream_disk_bytes", "disk_bytes"},
	{"slipstream_network_ingress_bytes_total", "ingress_bytes"},
	{"slipstream_network_egress_bytes_total", "egress_bytes"},
}

// readServiceAccountToken reads the pod's own ServiceAccount JWT for authenticating
// to the web app's internal endpoint.
func readServiceAccountToken() (string, error) {
	data, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token")
	if err != nil {
		return "", fmt.Errorf("read SA token: %w", err)
	}
	return strings.TrimSpace(string(data)), nil
}

// recordUsageSamples queries VictoriaMetrics for all 5 resource metrics across all
// running projects and POSTs raw values to the web app for storage in usage_samples.
func (c *Controller) recordUsageSamples(ctx context.Context) {
	if c.cfg.MetricsPushURL == "" || c.cfg.UsageReportURL == "" {
		return
	}

	now := time.Now().UTC()

	// Collect running project IDs from ProjectEnvironments.
	rawList, err := c.peClient.List(ctx, metav1.ListOptions{})
	if err != nil {
		klog.Errorf("usage sampling: failed to list ProjectEnvironments: %v", err)
		return
	}

	var projectIDs []string
	for i := range rawList.Items {
		pe, err := unstructuredToPE(&rawList.Items[i])
		if err != nil {
			continue
		}
		if pe.Spec.DesiredState == "running" {
			projectIDs = append(projectIDs, pe.Spec.ProjectID)
		}
	}

	if len(projectIDs) == 0 {
		return
	}

	// Query each metric from VictoriaMetrics.
	var samples []usageSample
	for _, m := range usageMetrics {
		metricValues, qErr := queryMetricInstant(ctx, c.cfg.MetricsPushURL, m.vmName)
		if qErr != nil {
			klog.Errorf("usage sampling: failed to query %s: %v", m.vmName, qErr)
			continue
		}

		for _, pid := range projectIDs {
			raw, ok := metricValues[pid]
			if !ok {
				continue
			}
			value := raw
			// memory_byte_seconds: multiply instantaneous bytes by sampling interval (60s)
			if m.dbName == "memory_byte_seconds" {
				value = raw * 60
			}
			samples = append(samples, usageSample{
				ProjectID: pid,
				Metric:    m.dbName,
				Value:     value,
				SampledAt: now.Format(time.RFC3339),
			})
		}
	}

	if len(samples) == 0 {
		return
	}

	token, err := readServiceAccountToken()
	if err != nil {
		klog.Errorf("usage sampling: %v", err)
		return
	}

	body, err := json.Marshal(usagePayload{Samples: samples})
	if err != nil {
		klog.Errorf("usage sampling: marshal error: %v", err)
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.UsageReportURL, bytes.NewReader(body))
	if err != nil {
		klog.Errorf("usage sampling: failed to build request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		klog.Errorf("usage sampling: POST failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		klog.Errorf("usage sampling: unexpected status %d from usage endpoint", resp.StatusCode)
	}
}

// queryMetricInstant queries a single metric by name and returns projectId → value.
func queryMetricInstant(ctx context.Context, pushURL, metricName string) (map[string]float64, error) {
	queryURL := strings.TrimRight(pushURL, "/") + "/api/v1/query"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, queryURL, nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("query", metricName)
	req.URL.RawQuery = q.Encode()

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("VictoriaMetrics returned %d", resp.StatusCode)
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
		pid := r.Metric["project_id"]
		if pid == "" {
			continue
		}
		if s, ok := r.Value[1].(string); ok {
			var v float64
			if _, err := fmt.Sscanf(s, "%f", &v); err == nil {
				out[pid] = v
			}
		}
	}
	return out, nil
}
