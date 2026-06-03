#!/usr/bin/env bash
# Creates (or updates) the Slipstream auth Secret in Kubernetes.
# Generates SESSION_SECRET and K8S_JWT_PRIVATE_KEY automatically.
# OIDC credentials are optional; omit any pair to skip that provider.
#
# Usage:
#   ./scripts/create-auth-secret.sh [OPTIONS]
#
# Options:
#   -n, --namespace       Kubernetes namespace (default: slipstream)
#   -s, --secret-name     Secret name (default: slipstream-auth-secret)
#   --google-id           GOOGLE_CLIENT_ID
#   --google-secret       GOOGLE_CLIENT_SECRET
#   --microsoft-id        MICROSOFT_CLIENT_ID
#   --microsoft-secret    MICROSOFT_CLIENT_SECRET
#   --github-id           GITHUB_CLIENT_ID
#   --github-secret       GITHUB_CLIENT_SECRET
#   --dry-run             Print the kubectl command without running it

set -euo pipefail

NAMESPACE="slipstream"
SECRET_NAME="slipstream-auth-secret"
GOOGLE_ID=""
GOOGLE_SECRET=""
MICROSOFT_ID=""
MICROSOFT_SECRET=""
GITHUB_ID=""
GITHUB_SECRET=""
DRY_RUN=false

usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# //'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -n|--namespace)       NAMESPACE="$2";       shift 2 ;;
    -s|--secret-name)     SECRET_NAME="$2";     shift 2 ;;
    --google-id)          GOOGLE_ID="$2";       shift 2 ;;
    --google-secret)      GOOGLE_SECRET="$2";   shift 2 ;;
    --microsoft-id)       MICROSOFT_ID="$2";    shift 2 ;;
    --microsoft-secret)   MICROSOFT_SECRET="$2"; shift 2 ;;
    --github-id)          GITHUB_ID="$2";       shift 2 ;;
    --github-secret)      GITHUB_SECRET="$2";   shift 2 ;;
    --dry-run)            DRY_RUN=true;         shift ;;
    -h|--help)            usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

for cmd in kubectl openssl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is required but not found in PATH" >&2
    exit 1
  fi
done

echo "Generating SESSION_SECRET..."
SESSION_SECRET=$(openssl rand -base64 32 | tr -d '=+/' | head -c 32)

echo "Generating RSA-4096 JWT private key (this may take a moment)..."
JWT_PRIVATE_KEY=$(openssl genrsa 4096 2>/dev/null | openssl pkcs8 -topk8 -nocrypt | base64 -w0)

LITERAL_ARGS=(
  "--from-literal=SESSION_SECRET=${SESSION_SECRET}"
  "--from-literal=K8S_JWT_PRIVATE_KEY=${JWT_PRIVATE_KEY}"
)

if [[ -n "$GOOGLE_ID" ]];       then LITERAL_ARGS+=("--from-literal=GOOGLE_CLIENT_ID=${GOOGLE_ID}"); fi
if [[ -n "$GOOGLE_SECRET" ]];   then LITERAL_ARGS+=("--from-literal=GOOGLE_CLIENT_SECRET=${GOOGLE_SECRET}"); fi
if [[ -n "$MICROSOFT_ID" ]];    then LITERAL_ARGS+=("--from-literal=MICROSOFT_CLIENT_ID=${MICROSOFT_ID}"); fi
if [[ -n "$MICROSOFT_SECRET" ]]; then LITERAL_ARGS+=("--from-literal=MICROSOFT_CLIENT_SECRET=${MICROSOFT_SECRET}"); fi
if [[ -n "$GITHUB_ID" ]];       then LITERAL_ARGS+=("--from-literal=GITHUB_CLIENT_ID=${GITHUB_ID}"); fi
if [[ -n "$GITHUB_SECRET" ]];   then LITERAL_ARGS+=("--from-literal=GITHUB_CLIENT_SECRET=${GITHUB_SECRET}"); fi

CMD=(
  kubectl create secret generic "$SECRET_NAME"
  --namespace "$NAMESPACE"
  "${LITERAL_ARGS[@]}"
  --save-config
  --dry-run=client
  -o yaml
)

if $DRY_RUN; then
  echo ""
  echo "--- Dry run: would apply the following Secret ---"
  "${CMD[@]}" | grep -v "K8S_JWT_PRIVATE_KEY\|SESSION_SECRET"
  echo "(secret values redacted)"
  exit 0
fi

echo ""
echo "Applying secret '${SECRET_NAME}' in namespace '${NAMESPACE}'..."
"${CMD[@]}" | kubectl apply -f -

echo ""
echo "Done. Reference in your Helm values:"
echo ""
echo "  auth:"
echo "    existingSecret: ${SECRET_NAME}"
