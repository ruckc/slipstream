package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	flowpb "github.com/cilium/cilium/api/v1/flow"
	observerpb "github.com/cilium/cilium/api/v1/observer"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	flowTypeDNS  = "dns"
	flowTypeHTTP = "http"
	flowTypeL4   = "l4"
)

func main() {
	hubbleAddr := getenv("HUBBLE_RELAY_ADDRESS", "hubble-relay.kube-system.svc.cluster.local:4245")
	databaseURL := mustenv("DATABASE_URL")

	log.Printf("slipstream-hubble-collector starting: relay=%s", hubbleAddr)

	ctx := context.Background()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect to postgres: %v", err)
	}
	defer pool.Close()

	for {
		if err := runCollector(ctx, hubbleAddr, pool); err != nil {
			log.Printf("collector error: %v — reconnecting in 10s", err)
			time.Sleep(10 * time.Second)
		}
	}
}

func runCollector(ctx context.Context, hubbleAddr string, pool *pgxpool.Pool) error {
	conn, err := grpc.NewClient(hubbleAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return fmt.Errorf("grpc dial: %w", err)
	}
	defer conn.Close()

	client := observerpb.NewObserverClient(conn)

	stream, err := client.GetFlows(ctx, &observerpb.GetFlowsRequest{
		Follow: true,
		Whitelist: []*flowpb.FlowFilter{
			{
				// Only egress flows from pods with our project label.
				SourceLabel: []string{"slipstream.io/project-id"},
				TrafficDirection: []flowpb.TrafficDirection{
					flowpb.TrafficDirection_EGRESS,
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("GetFlows: %w", err)
	}

	log.Printf("connected to Hubble relay at %s, streaming flows", hubbleAddr)

	for {
		resp, err := stream.Recv()
		if err != nil {
			return fmt.Errorf("stream recv: %w", err)
		}

		f := resp.GetFlow()
		if f == nil {
			continue
		}

		projectID := extractProjectID(f.GetSource().GetLabels())
		if projectID == "" {
			continue
		}

		if err := insertFlow(ctx, pool, projectID, f); err != nil {
			log.Printf("insert flow: %v", err)
		}
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
