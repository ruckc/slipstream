<div align="center">
  <img src="icon.svg" width="80" alt="Slipstream icon"/>
  <h1>Slipstream</h1>
  <p>Self-hosted cloud development environments on Kubernetes</p>

  [![CI](https://github.com/ruckc/slipstream/actions/workflows/ci.yml/badge.svg)](https://github.com/ruckc/slipstream/actions/workflows/ci.yml)
</div>

---

Slipstream provisions on-demand, isolated development environments as Kubernetes pods. Each project gets persistent workspace and home volumes, a terminal, a file browser, and a pod that starts on demand and idles itself down automatically when not in use.

## How it works

The browser communicates exclusively with the Kubernetes Gateway API. Two sets of HTTPRoutes share the same hostname:

- `/*` → SvelteKit web app (catch-all)
- `/env/{namespace}/{project}/*` → project pod (per-project route, prefix stripped before forwarding)

The web app never proxies pod traffic — the gateway routes it directly. Every request to a pod carries a short-lived RS256 JWT issued by `/api/token` and validated by the in-pod Rust agent via the JWKS endpoint.

Projects are managed via a `ProjectEnvironment` custom resource. The **project-controller** operator watches these CRs and reconciles a Deployment, Service, HTTPRoute, NetworkPolicy, and two PVCs (workspace at `/workspace`, home at `/home/agent`) per project. Setting `spec.desiredState` to `stopped` scales the Deployment to zero; PVCs are preserved across stop/start cycles and only deleted when a project is explicitly removed.

The **metrics-collector** scrapes each running agent pod's `/metrics` endpoint and stores usage samples in Postgres, powering the resource usage view and idle-shutdown detection.

## Stack

| Layer | Technology |
|---|---|
| Web app | SvelteKit 5 + Svelte 5 (runes) |
| In-pod agent | Rust (HTTP + WebSocket, PTY, file ops, metrics) |
| Metrics collector | Rust (scrapes agent `/metrics` → Postgres) |
| Kubernetes operator | Go (reconciles `ProjectEnvironment` CRs) |
| Network flows | Go (Cilium/Hubble Relay → Postgres) |
| Database | PostgreSQL via Drizzle ORM |
| Auth | OpenID Connect (Google, Microsoft) + GitHub OAuth2 |
| Infrastructure | Kubernetes Gateway API, PVCs, NetworkPolicy, Cilium |

## Getting started

### Prerequisites

- Kubernetes cluster with [Gateway API](https://gateway-api.sigs.k8s.io/) installed
- PostgreSQL database
- An OIDC provider (Google, Microsoft, or GitHub)

### Configuration

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_URL` | yes | Public base URL (used for OIDC redirect URIs) |
| `AGENT_IMAGE` | yes | Docker image for project pods — read by project-controller |
| `GATEWAY_NAME` | yes | Name of the Gateway API `Gateway` resource |
| `GATEWAY_NAMESPACE` | yes | Namespace containing the gateway |
| `GATEWAY_HOSTNAME` | yes | Hostname the gateway serves |
| `SESSION_SECRET` | yes (prod) | HMAC-SHA256 key for signing session cookies |
| `GOOGLE_CLIENT_ID` / `_SECRET` | no | Enables Google OIDC login |
| `MICROSOFT_CLIENT_ID` / `_SECRET` | no | Enables Microsoft OIDC login |
| `GITHUB_CLIENT_ID` / `_SECRET` | no | Enables GitHub OAuth2 login |
| `DEFAULT_IDLE_TIMEOUT_SECONDS` | no | Pod idle timeout (default: 1800) |
| `AGENT_STORAGE_CLASS` | no | PVC storage class (default: `standard`) |
| `METRICS_PUSH_URL` | no | VictoriaMetrics endpoint — enables idle shutdown in controller |
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
# Install toolchains and JS dependencies
mise install
pnpm install

# Formatting
mise run format          # all projects
mise run format:web      # Prettier (apps/web)
mise run format:rust     # rustfmt (apps/agent, apps/metrics-collector)
mise run format:go       # gofmt (apps/project-controller, apps/hubble-collector)

# Linting / type-checking
mise run lint            # all linters
mise run lint:web        # Prettier check + ESLint
mise run typecheck:web   # svelte-check
mise run lint:rust       # cargo fmt --check + clippy
mise run lint:go         # gofmt check + go vet
mise run lint:helm       # helm lint

# Local dev cluster (kind + local registry on localhost:5001)
mise run dev:cluster     # create kind cluster + registry (idempotent)
mise run dev:build       # build all images and push to localhost:5001
mise run dev:build web   # build a single image (web | agent | metrics-collector | project-controller | hubble-collector)
mise run install         # helm upgrade --install → wait for rollout → db migrate

# Web app
pnpm --filter @slipstream/web dev          # dev server
pnpm --filter @slipstream/web db:generate  # generate migration from schema changes
pnpm --filter @slipstream/web db:migrate   # apply migrations
pnpm --filter @slipstream/web db:seed:dev  # seed dev accounts (requires DATABASE_URL)

# Rust (run from apps/agent/ or apps/metrics-collector/)
cargo build
cargo test

# Go (run from apps/project-controller/ or apps/hubble-collector/)
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

Releases are created by triggering the `release` workflow manually from `main`. It analyses conventional commits since the last tag to determine the version bump (`feat!`/`BREAKING CHANGE` → major, `feat` → minor, else patch), updates all version files, tags, builds all Docker images, and publishes a GitHub Release.

Images are published to `ghcr.io/ruckc/`:

- `slipstream-web`
- `slipstream-agent`
- `slipstream-metrics-collector`
- `slipstream-project-controller`
- `slipstream-hubble-collector`

## License

MIT
