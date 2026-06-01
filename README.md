<div align="center">
  <img src="icon.svg" width="80" alt="Slipstream icon"/>
  <h1>Slipstream</h1>
  <p>Self-hosted cloud development environments on Kubernetes</p>

  [![CI](https://github.com/ruckc/slipstream/actions/workflows/ci.yml/badge.svg)](https://github.com/ruckc/slipstream/actions/workflows/ci.yml)
</div>

---

Slipstream provisions on-demand, isolated development environments as Kubernetes pods. Each project gets a persistent volume, a terminal, a file browser, and a pod that starts on demand and idles itself down automatically when not in use.

## How it works

The browser communicates exclusively with the Kubernetes Gateway API. Two sets of HTTPRoutes share the same hostname:

- `/*` → SvelteKit web app (catch-all)
- `/env/{namespace}/{project}/*` → project pod (per-project route, prefix stripped before forwarding)

The web app never proxies pod traffic — the gateway routes it directly. Every request to a pod carries a short-lived RS256 JWT issued by `/api/token` and validated by the in-pod Rust agent via the JWKS endpoint.

Pods are plain `Pod` resources with `restartPolicy: Never`. When the Rust agent detects no active connections for the configured idle timeout it exits with code 0, the pod reaches `Completed`, and the web app marks the project stopped via a Kubernetes watch. PVCs are preserved across stop/start cycles and only deleted when a project is explicitly removed.

## Stack

| Layer | Technology |
|---|---|
| Web app | SvelteKit 5 + Svelte 5 (runes) |
| In-pod agent | Rust (HTTP + WebSocket, PTY, file ops) |
| Metrics sidecar | Go (cgroup/proc → VictoriaMetrics) |
| Database | PostgreSQL via Drizzle ORM |
| Auth | OpenID Connect (Google, Microsoft) + GitHub OAuth2 |
| Infrastructure | Kubernetes Gateway API, PVCs, NetworkPolicy |

## Getting started

### Prerequisites

- Kubernetes cluster with [Gateway API](https://gateway-api.sigs.k8s.io/) installed
- PostgreSQL database
- An OIDC provider (Google, Microsoft, or GitHub)

### Configuration

The web app is configured via environment variables:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_URL` | yes | Public base URL (used for OIDC redirect URIs) |
| `AGENT_IMAGE` | yes | Docker image for project pods |
| `GATEWAY_NAME` | yes | Name of the Gateway API `Gateway` resource |
| `GATEWAY_NAMESPACE` | yes | Namespace containing the gateway |
| `GATEWAY_HOSTNAME` | yes | Hostname the gateway serves |
| `GOOGLE_CLIENT_ID` / `_SECRET` | no | Enables Google OIDC login |
| `MICROSOFT_CLIENT_ID` / `_SECRET` | no | Enables Microsoft OIDC login |
| `GITHUB_CLIENT_ID` / `_SECRET` | no | Enables GitHub OAuth2 login |
| `DEFAULT_IDLE_TIMEOUT_SECONDS` | no | Pod idle timeout (default: 1800) |
| `AGENT_STORAGE_CLASS` | no | PVC storage class (default: `standard`) |
| `METRICS_SIDECAR_IMAGE` | no | Enables the Go metrics sidecar in pods |
| `METRICS_PUSH_URL` | no | VictoriaMetrics remote write endpoint |
| `K8S_JWT_PRIVATE_KEY` | no | Base64 PKCS8 PEM for multi-replica deployments |

### Helm install

```bash
helm install slipstream oci://ghcr.io/ruckc/charts/slipstream \
  --namespace slipstream-system \
  --create-namespace \
  --set web.env.DATABASE_URL="postgres://..." \
  --set web.env.APP_URL="https://slipstream.example.com" \
  --set web.env.AGENT_IMAGE="ghcr.io/ruckc/slipstream-agent:latest" \
  --set web.env.GATEWAY_NAME="..." \
  --set web.env.GATEWAY_NAMESPACE="..." \
  --set web.env.GATEWAY_HOSTNAME="slipstream.example.com"
```

## Development

Requires [mise](https://mise.jdx.dev/) for tool version management.

```bash
# Install Node/pnpm/Rust/Go toolchains
mise install

# Install JS dependencies
pnpm install

# Start the web dev server
pnpm --filter @slipstream/web dev

# Run checks (also run in CI)
pnpm --filter @slipstream/web format:check
pnpm --filter @slipstream/web lint
pnpm --filter @slipstream/web check

# Database
pnpm --filter @slipstream/web db:generate   # generate migration from schema changes
pnpm --filter @slipstream/web db:migrate    # apply migrations
pnpm --filter @slipstream/web db:seed:dev   # seed dev accounts (requires DATABASE_URL)

# Rust agent
cd apps/agent
cargo build
cargo test
cargo clippy --all-targets --all-features -- -D warnings

# Go metrics sidecar
cd apps/metrics-sidecar
go build ./...
go test ./...
```

### Dev mode

Set `DEV_MODE=true` to enable the `/auth/dev` login endpoint. Run `pnpm db:seed:dev` to create five test accounts with fixed UUIDs (`00000000-0000-0000-0000-00000000000{1–5}`).

## Namespace model

Slugs are globally unique across all users and orgs. Kubernetes namespaces are prefixed: user `alice` → `u-alice`, org `acme` → `o-acme`. First registrant of a slug wins permanently.

## Permission model

Four permission bits: `files:read`, `files:write`, `shell`, `project:manage`. Resolution order:

1. User owns the namespace → all permissions on their projects
2. User is an org owner → all permissions on all org projects
3. Explicit `project_permissions` row for the user
4. Explicit `project_permissions` row for any org the user belongs to

## Releases

Releases are created by triggering the `release` workflow manually from `main`. It analyses conventional commits since the last tag to determine the version bump (`feat!`/`BREAKING CHANGE` → major, `feat` → minor, else patch), updates all version files, tags, builds all three Docker images, and publishes a GitHub Release.

Images are published to `ghcr.io/ruckc/`:

- `slipstream-web`
- `slipstream-agent`
- `slipstream-metrics-sidecar`

## License

MIT
