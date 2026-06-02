#!/usr/bin/env bash
# Kind integration test for the slipstream Helm chart.
#
# Default mode: creates a kind cluster and does a server-side dry-run to validate
# all chart resources against a real Kubernetes API server with Gateway API CRDs.
#
# Full mode (--full): also deploys a test PostgreSQL and installs the chart,
# then waits for the web deployment to become ready.
#
# Usage:
#   scripts/kind-test.sh           # schema validation only
#   scripts/kind-test.sh --full    # full install against a live cluster
#   scripts/kind-test.sh --help

set -euo pipefail

CLUSTER_NAME="slipstream-test"
GATEWAY_API_VERSION="v1.2.1"
CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/charts/slipstream"
FULL_INSTALL=false

usage() {
  echo "Usage: $0 [--full] [--help]"
  echo ""
  echo "  --full   Full install with test PostgreSQL (default: schema validation only)"
  echo "  --help   Show this help"
  exit 0
}

for arg in "$@"; do
  case $arg in
    --full) FULL_INSTALL=true ;;
    --help) usage ;;
    *) echo "Unknown argument: $arg"; usage ;;
  esac
done

for cmd in kind kubectl helm docker; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd is required but not found" >&2
    exit 1
  fi
done

cleanup() {
  echo ""
  echo "==> Cleaning up kind cluster: $CLUSTER_NAME"
  kind delete cluster --name "$CLUSTER_NAME" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Creating kind cluster: $CLUSTER_NAME"
kind create cluster --name "$CLUSTER_NAME" --wait 60s

echo ""
echo "==> Installing Gateway API CRDs ($GATEWAY_API_VERSION)"
kubectl apply -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY_API_VERSION}/standard-install.yaml"
# Brief pause: status.conditions is nil immediately after creation and kubectl wait
# returns an accessor error if it runs before the API server has populated it.
sleep 5
kubectl wait --for condition=established --timeout=60s \
  crd/gatewayclasses.gateway.networking.k8s.io \
  crd/gateways.gateway.networking.k8s.io \
  crd/grpcroutes.gateway.networking.k8s.io \
  crd/httproutes.gateway.networking.k8s.io \
  crd/referencegrants.gateway.networking.k8s.io

echo ""
echo "==> Running helm lint"
helm lint "$CHART_DIR"

echo ""
echo "==> Pre-creating slipstream-system namespace"
kubectl create namespace slipstream-system

if [ "$FULL_INSTALL" = true ]; then
  echo ""
  echo "==> Full install mode"

  echo "==> Deploying test PostgreSQL"
  kubectl run postgres \
    --image=postgres:16-alpine \
    --env="POSTGRES_PASSWORD=testpass" \
    --env="POSTGRES_USER=slipstream" \
    --env="POSTGRES_DB=slipstream" \
    --restart=Never \
    -n slipstream-system
  kubectl expose pod postgres --port=5432 -n slipstream-system
  kubectl wait --for=condition=ready pod/postgres -n slipstream-system --timeout=120s

  echo ""
  echo "==> Installing chart in dev mode"
  helm install slipstream "$CHART_DIR" \
    -f "$CHART_DIR/values-dev.yaml" \
    -f "$CHART_DIR/ci/values.yaml" \
    --set "database.url=postgresql://slipstream:testpass@postgres.slipstream-system.svc.cluster.local:5432/slipstream" \
    --namespace slipstream-system \
    --wait \
    --timeout=180s

  echo ""
  echo "==> Deployment status"
  kubectl get pods,services -n slipstream-system

  echo ""
  echo "==> Uninstalling chart"
  helm uninstall slipstream -n slipstream-system

  echo ""
  echo "PASS: full install completed successfully"
else
  echo ""
  echo "==> Server-side dry-run (schema validation)"
  helm template slipstream "$CHART_DIR" \
    -f "$CHART_DIR/ci/values.yaml" \
    --namespace slipstream-system \
    | kubectl apply --dry-run=server -f -

  echo ""
  echo "PASS: schema validation completed successfully"
fi
