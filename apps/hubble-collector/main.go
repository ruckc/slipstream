package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	flowpb "github.com/cilium/cilium/api/v1/flow"
	observerpb "github.com/cilium/cilium/api/v1/observer"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	flowTypeDNS  = "dns"
	flowTypeHTTP = "http"
	flowTypeL4   = "l4"
)

func main() {
	// Path to Cilium's Hubble static flow-log export file. Cilium writes
	// newline-delimited JSON ({"flow":{...}}) here, one line per flow, filtered
	// by the allowlist configured in the CNI (source label slipstream.io/project-id).
	exportFile := getenv("HUBBLE_EXPORT_FILE", "/var/run/cilium/hubble/events.log")
	databaseURL := mustenv("DATABASE_URL")

	log.Printf("slipstream-hubble-collector starting: export_file=%s", exportFile)

	ctx := context.Background()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect to postgres: %v", err)
	}
	defer pool.Close()

	for {
		if err := tailExport(ctx, exportFile, pool); err != nil {
			log.Printf("tail error: %v — retrying in 10s", err)
			time.Sleep(10 * time.Second)
		}
	}
}

// tailExport follows the Hubble export file. It starts at the current end of
// the file (so a restart doesn't replay stored flows) and transparently
// handles Cilium rotating the file, detected by inode change (rename) or
// truncation (size shrank below our read offset).
//
// Only complete newline-terminated lines are processed; a partial trailing
// line is left to be re-read on the next cycle by re-seeking to the last
// committed offset before recreating the buffered reader.
func tailExport(ctx context.Context, path string, pool *pgxpool.Pool) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	offset, err := f.Seek(0, io.SeekEnd)
	if err != nil {
		return err
	}

	for {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			return err
		}
		reader := bufio.NewReader(f)
		for {
			line, err := reader.ReadString('\n')
			if err == nil {
				handleLine(ctx, pool, strings.TrimSpace(line))
				offset += int64(len(line))
				continue
			}
			// EOF (with possibly a partial line we intentionally ignore).
			break
		}

		time.Sleep(time.Second)

		// Rotation detection: reopen the path and compare to our open fd.
		rotated, err := isRotated(f, path, offset)
		if err != nil {
			return err
		}
		if rotated {
			_ = f.Close()
			if f, err = os.Open(path); err != nil {
				return err
			}
			offset = 0
		}
	}
}

// isRotated reports whether the file at path is no longer the same file as the
// open fd (rename rotation) or has been truncated below our read offset.
func isRotated(f *os.File, path string, offset int64) (bool, error) {
	fInfo, err := f.Stat()
	if err != nil {
		return false, err
	}
	if fInfo.Size() < offset {
		return true, nil // truncated in place
	}
	pathInfo, err := os.Stat(path)
	if err != nil {
		return false, nil // path briefly missing during rotation; retry next cycle
	}
	return !os.SameFile(pathInfo, fInfo), nil
}

// handleLine parses a single export line and inserts the flow if it carries a
// project id. Malformed lines are logged and skipped.
func handleLine(ctx context.Context, pool *pgxpool.Pool, line string) {
	if line == "" {
		return
	}
	var resp observerpb.GetFlowsResponse
	if err := protojson.Unmarshal([]byte(line), &resp); err != nil {
		log.Printf("parse flow line: %v", err)
		return
	}
	f := resp.GetFlow()
	if f == nil {
		return
	}
	projectID := extractProjectID(f.GetSource().GetLabels())
	if projectID == "" {
		return
	}
	if err := insertFlow(ctx, pool, projectID, f); err != nil {
		log.Printf("insert flow: %v", err)
	}
}

// extractProjectID looks for the "slipstream.io/project-id=<uuid>" label in the Hubble
// endpoint label list (format: "k8s:key=value" or "key=value").
func extractProjectID(labels []string) string {
	for _, l := range labels {
		l = strings.TrimPrefix(l, "k8s:")
		if strings.HasPrefix(l, "slipstream.io/project-id=") {
			return strings.TrimPrefix(l, "slipstream.io/project-id=")
		}
	}
	return ""
}

func insertFlow(ctx context.Context, pool *pgxpool.Pool, projectID string, f *flowpb.Flow) error {
	observedAt := f.GetTime().AsTime()
	verdict := verdictString(f.GetVerdict())
	srcIP := f.GetIP().GetSource()
	dstIP := f.GetIP().GetDestination()

	var (
		flowType   string
		protocol   *string
		dstPort    *int32
		dnsQuery   *string
		dnsRcode   *string
		dnsRespIPs []string
		httpMethod *string
		httpURL    *string
		httpStatus *int32
		httpProto  *string
	)

	switch l7 := f.GetL7().GetRecord().(type) {
	case *flowpb.Layer7_Dns:
		flowType = flowTypeDNS
		if l7.Dns != nil {
			q := l7.Dns.GetQuery()
			dnsQuery = &q
			rc := fmt.Sprintf("%d", l7.Dns.GetRcode())
			dnsRcode = &rc
			dnsRespIPs = l7.Dns.GetIps()
		}
	case *flowpb.Layer7_Http:
		flowType = flowTypeHTTP
		if l7.Http != nil {
			m := l7.Http.GetMethod()
			httpMethod = &m
			u := l7.Http.GetUrl()
			httpURL = &u
			s := int32(l7.Http.GetCode())
			httpStatus = &s
			p := l7.Http.GetProtocol()
			httpProto = &p
		}
	default:
		flowType = flowTypeL4
	}

	if l4 := f.GetL4(); l4 != nil {
		switch p := l4.GetProtocol().(type) {
		case *flowpb.Layer4_TCP:
			proto := "TCP"
			protocol = &proto
			port := int32(p.TCP.GetDestinationPort())
			dstPort = &port
		case *flowpb.Layer4_UDP:
			proto := "UDP"
			protocol = &proto
			port := int32(p.UDP.GetDestinationPort())
			dstPort = &port
		case *flowpb.Layer4_ICMPv4:
			proto := "ICMP"
			protocol = &proto
		case *flowpb.Layer4_ICMPv6:
			proto := "ICMPv6"
			protocol = &proto
		}
	}

	_, err := pool.Exec(ctx, `
		INSERT INTO network_flows (
			project_id, observed_at, flow_type, verdict,
			source_ip, dest_ip, dest_port, protocol,
			dns_query, dns_rcode, dns_response_ips,
			http_method, http_url, http_status, http_protocol
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7, $8,
			$9, $10, $11,
			$12, $13, $14, $15
		)`,
		projectID, observedAt, flowType, verdict,
		nilStr(srcIP), nilStr(dstIP), dstPort, protocol,
		dnsQuery, dnsRcode, dnsRespIPs,
		httpMethod, httpURL, httpStatus, httpProto,
	)
	return err
}

func verdictString(v flowpb.Verdict) string {
	switch v {
	case flowpb.Verdict_FORWARDED:
		return "forwarded"
	case flowpb.Verdict_DROPPED:
		return "dropped"
	case flowpb.Verdict_REDIRECTED:
		return "redirected"
	case flowpb.Verdict_AUDIT:
		return "audited"
	default:
		return "unknown"
	}
}

func nilStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func mustenv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required env var %s is not set", key)
	}
	return v
}
