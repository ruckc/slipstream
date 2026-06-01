package main

import (
	"bufio"
	"bytes"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func main() {
	projectID := getenv("PROJECT_ID", "")
	if projectID == "" {
		log.Fatal("PROJECT_ID environment variable is required")
	}

	pushURL := getenv("PUSH_URL", "http://victoriametrics.metrics.svc.cluster.local:8428")
	pushURL = strings.TrimRight(pushURL, "/")

	intervalStr := getenv("PUSH_INTERVAL", "30")
	intervalSecs, err := strconv.Atoi(intervalStr)
	if err != nil || intervalSecs < 1 {
		log.Printf("Invalid PUSH_INTERVAL=%q, defaulting to 30", intervalStr)
		intervalSecs = 30
	}

	workspacePath := getenv("WORKSPACE_PATH", "/workspace")

	log.Printf("slipstream-metrics-sidecar starting: project_id=%s push_url=%s interval=%ds workspace=%s",
		projectID, pushURL, intervalSecs, workspacePath)

	var (
		prevCPUUsec    uint64
		prevRxBytes    uint64
		prevTxBytes    uint64
		firstIteration = true
	)

	ticker := time.NewTicker(time.Duration(intervalSecs) * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		// --- CPU ---
		cpuUsec, cpuErr := readCPUUsec()

		// --- Memory ---
		memBytes, memErr := readMemoryBytes()

		// --- Disk ---
		diskBytes, diskErr := readDiskBytes(workspacePath)

		// --- Network ---
		rxBytes, txBytes, netErr := readNetworkBytes("eth0")

		// Build metrics string
		var metricsBuilder strings.Builder
		labelStr := fmt.Sprintf(`{project_id="%s"}`, projectID)
		ts := fmt.Sprintf("%d", time.Now().UnixMilli())

		if cpuErr == nil {
			// Compute delta since last reading (expose cumulative seconds total)
			cpuSeconds := float64(cpuUsec) / 1e6
			fmt.Fprintf(&metricsBuilder, "slipstream_cpu_seconds_total%s %g %s\n", labelStr, cpuSeconds, ts)

			if !firstIteration && cpuUsec >= prevCPUUsec {
				deltaSec := float64(cpuUsec-prevCPUUsec) / 1e6
				fmt.Fprintf(&metricsBuilder, "slipstream_cpu_delta_seconds%s %g %s\n", labelStr, deltaSec, ts)
			}
			prevCPUUsec = cpuUsec
		} else {
			log.Printf("cpu read error: %v", cpuErr)
		}

		if memErr == nil {
			fmt.Fprintf(&metricsBuilder, "slipstream_memory_bytes%s %d %s\n", labelStr, memBytes, ts)
		} else {
			log.Printf("memory read error: %v", memErr)
		}

		if diskErr == nil {
			fmt.Fprintf(&metricsBuilder, "slipstream_disk_bytes%s %d %s\n", labelStr, diskBytes, ts)
		} else {
			log.Printf("disk read error: %v", diskErr)
		}

		if netErr == nil {
			fmt.Fprintf(&metricsBuilder, "slipstream_network_ingress_bytes_total%s %d %s\n", labelStr, rxBytes, ts)
			fmt.Fprintf(&metricsBuilder, "slipstream_network_egress_bytes_total%s %d %s\n", labelStr, txBytes, ts)

			if !firstIteration {
				if rxBytes >= prevRxBytes {
					fmt.Fprintf(&metricsBuilder, "slipstream_network_ingress_delta_bytes%s %d %s\n", labelStr, rxBytes-prevRxBytes, ts)
				}
				if txBytes >= prevTxBytes {
					fmt.Fprintf(&metricsBuilder, "slipstream_network_egress_delta_bytes%s %d %s\n", labelStr, txBytes-prevTxBytes, ts)
				}
			}
			prevRxBytes = rxBytes
			prevTxBytes = txBytes
		} else {
			log.Printf("network read error: %v", netErr)
		}

		firstIteration = false

		payload := metricsBuilder.String()
		if payload == "" {
			continue
		}

		if pushErr := pushMetrics(pushURL, payload); pushErr != nil {
			log.Printf("push error: %v", pushErr)
		}
	}
}

// readCPUUsec reads the cumulative CPU usage in microseconds from the cgroup v2 cpu.stat file.
func readCPUUsec() (uint64, error) {
	const path = "/sys/fs/cgroup/cpu.stat"
	f, err := os.Open(path)
	if err != nil {
		return 0, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "usage_usec ") {
			parts := strings.Fields(line)
			if len(parts) < 2 {
				continue
			}
			v, err := strconv.ParseUint(parts[1], 10, 64)
			if err != nil {
				return 0, fmt.Errorf("parse usage_usec: %w", err)
			}
			return v, nil
		}
	}

	if err := scanner.Err(); err != nil {
		return 0, fmt.Errorf("scan %s: %w", path, err)
	}

	return 0, fmt.Errorf("usage_usec not found in %s", path)
}

// readMemoryBytes reads the current memory usage in bytes from cgroup v2.
func readMemoryBytes() (uint64, error) {
	const path = "/sys/fs/cgroup/memory.current"
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("read %s: %w", path, err)
	}
	v, err := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", path, err)
	}
	return v, nil
}

// readDiskBytes runs `du -sb workspacePath` and returns the byte count.
func readDiskBytes(workspacePath string) (uint64, error) {
	cmd := exec.Command("du", "-sb", workspacePath)
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("du -sb %s: %w", workspacePath, err)
	}
	// Output format: "<bytes>\t<path>\n"
	fields := strings.Fields(string(out))
	if len(fields) < 1 {
		return 0, fmt.Errorf("unexpected du output: %q", string(out))
	}
	v, err := strconv.ParseUint(fields[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse du output: %w", err)
	}
	return v, nil
}

// readNetworkBytes parses /proc/net/dev and returns rx_bytes, tx_bytes for the given interface.
// Column layout (space-separated after the colon):
//
//	Interface: rx_bytes rx_pkts rx_errs rx_drop rx_fifo rx_frame rx_compressed rx_multicast
//	           tx_bytes tx_pkts tx_errs tx_drop tx_fifo tx_colls tx_carrier tx_compressed
//
// So rx_bytes = col 0 (0-indexed after splitting), tx_bytes = col 8.
func readNetworkBytes(iface string) (rxBytes, txBytes uint64, err error) {
	const path = "/proc/net/dev"
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		colonIdx := strings.Index(line, ":")
		if colonIdx < 0 {
			continue
		}
		name := strings.TrimSpace(line[:colonIdx])
		if name != iface {
			continue
		}
		fields := strings.Fields(line[colonIdx+1:])
		if len(fields) < 10 {
			return 0, 0, fmt.Errorf("unexpected /proc/net/dev format for %s: %q", iface, line)
		}
		rx, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			return 0, 0, fmt.Errorf("parse rx_bytes for %s: %w", iface, err)
		}
		// tx_bytes is field index 8 (9th field after the colon)
		tx, err := strconv.ParseUint(fields[8], 10, 64)
		if err != nil {
			return 0, 0, fmt.Errorf("parse tx_bytes for %s: %w", iface, err)
		}
		return rx, tx, nil
	}

	if scanErr := scanner.Err(); scanErr != nil {
		return 0, 0, fmt.Errorf("scan %s: %w", path, scanErr)
	}

	return 0, 0, fmt.Errorf("interface %q not found in %s", iface, path)
}

// pushMetrics sends Prometheus text-format metrics to VictoriaMetrics via the import API.
func pushMetrics(pushURL, payload string) error {
	url := pushURL + "/api/v1/import/prometheus"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewBufferString(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "text/plain")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("unexpected status %d from %s", resp.StatusCode, url)
	}

	return nil
}

// getenv returns the environment variable value or a default.
func getenv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
