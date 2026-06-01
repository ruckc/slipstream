# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Monorepo managed with pnpm workspaces (`pnpm-workspace.yaml`).

```
apps/
  web/              # SvelteKit 5 + Svelte 5 — the main web application
  agent/            # Rust — HTTP service that runs inside each project pod
  metrics-sidecar/  # Go — reads cgroup/proc metrics, pushes to VictoriaMetrics
deploy/
  templates/        # Kubernetes resource templates (Pod, PVC, Service, HTTPRoute, NetworkPolicy)
  manifests/        # Cluster-level resources (web deployment, VictoriaMetrics, RBAC)
docker/
  web/              # Dockerfile for the SvelteKit app
  agent/            # Dockerfile for the Rust agent
  metrics-sidecar/  # Dockerfile for the Go sidecar
.github/workflows/
  ci.yml            # checks + edge image push on every push to main / PR
  release.yml       # manual workflow_dispatch — bumps version, tags, builds, publishes
```

## Commands

All pnpm commands run from the repo root unless noted.

```bash
# Install all workspace dependencies
pnpm install

# Web app
pnpm --filter @slipstream/web dev          # dev server
pnpm --filter @slipstream/web build        # production build
pnpm --filter @slipstream/web check        # svelte-check type checking
pnpm --filter @slipstream/web lint         # eslint
pnpm --filter @slipstream/web format       # prettier write
pnpm --filter @slipstream/web format:check # prettier check (used in CI)

# Database (run from apps/web/ or use filter)
pnpm --filter @slipstream/web db:generate  # drizzle-kit generate migration
pnpm --filter @slipstream/web db:migrate   # apply migrations
pnpm --filter @slipstream/web db:seed:dev  # seed dev accounts (requires DATABASE_URL)

# Rust agent (run from apps/agent/)
cargo build
cargo build --release
cargo test
cargo fmt
cargo clippy --all-targets --all-features -- -D warnings

# Go metrics sidecar (run from apps/metrics-sidecar/)
go build ./...
go test ./...
gofmt -w .
```

## Architecture

### Request flow

The browser talks exclusively to the Gateway API. Two sets of HTTPRoutes exist for the same hostname:

- `/*` → SvelteKit web app (catch-all, lowest priority)
- `/env/{namespace-slug}/{project-slug}/*` → project pod (per-project HTTPRoute, prefix stripped before forwarding)

The SvelteKit server never proxies pod traffic — the gateway routes it directly. Every pod request carries a short-lived RS256 JWT (`Authorization: Bearer`) issued by the SvelteKit `/api/token` endpoint and validated by the Rust agent via the SvelteKit `/api/jwks` endpoint.

### Namespace model

Slugs are globally unique across users and orgs (enforced by a DB unique index on `namespaces.slug`). Kubernetes namespaces are prefixed: user `alice` → `u-alice`, org `acme` → `o-acme`. First registrant of a slug wins permanently.

### Pod lifecycle

Projects have status: `stopped → starting → running → stopping → stopped`. Pods are plain `Pod` resources (not Deployments) with `restartPolicy: Never`. When the Rust agent reaches its idle timeout (no WebSocket connections for `IDLE_TIMEOUT_SECONDS`) it exits with code 0, the pod reaches `Completed`, and the SvelteKit server detects this via a k8s watch and marks the project stopped. PVCs are never deleted when a pod stops — only when a project is explicitly deleted.

Idle timeout resolution priority: `project.idleTimeoutSeconds` → `org/user.idleTimeoutSeconds` → `DEFAULT_IDLE_TIMEOUT_SECONDS` env var (default 1800 s).

### JWT issuance

`src/lib/server/jwt/keys.ts` manages an RS256 keypair — ephemeral in-memory for single-replica dev, or loaded from the `K8S_JWT_PRIVATE_KEY` env var (base64 PKCS8 PEM) for multi-replica. The pod fetches the JWKS from `http://slipstream-web.slipstream-system.svc.cluster.local/api/jwks` on startup and caches with a 5-minute TTL. The NetworkPolicy explicitly allows this egress from pods.

JWT claims: `{ sub: userId, projectId, permissions: string[], exp, iat }`. The agent enforces permissions per route: `files:read` for downloads/listing, `files:write` for upload/delete/mkdir, `shell` for PTY sessions.

### Permission model

Four independent permission bits: `files:read`, `files:write`, `shell`, `project:manage`. Resolution rules in `src/lib/server/permissions.ts`:
1. User-namespace owner → all permissions on their own projects
2. Org owner → all permissions on all org projects
3. Explicit `project_permissions` row for the user
4. Explicit `project_permissions` row for any org the user belongs to

### Remote functions pattern

All server-side business logic lives in `src/lib/remote/*.remote.ts` as plain async TypeScript functions. SvelteKit route files (`+page.server.ts`, `+server.ts`) are thin call-through wrappers. No business logic in route files.

### Svelte constraints

- **No `{@html}`** anywhere — renders `{@html}` would be an XSS/CSS injection vector.
- **Syntax highlighting**: Shiki's `codeToTokens()` returns `ThemedToken[][]`; these are rendered as `<span style:color={token.color}>` elements. No HTML string output.
- **Markdown**: `marked.lexer()` produces an AST; a component tree (`MarkdownRenderer` → typed sub-components) renders each token type. Raw HTML tokens are dropped.
- **Svelte 5 runes** everywhere: `$props()`, `$state()`, `$effect()`, `$derived()`. No Svelte 4 `export let` or reactive `$:` syntax.
- **No Tailwind** — all styling via CSS custom properties defined in `src/lib/styles/tokens.css`. Component `<style>` blocks reference `var(--color-*)`, `var(--space-*)`, etc.

### Client-side JWT handling

`src/lib/token-store.ts` holds a per-project token cache. Before any request to a pod, `tokenStore.get(projectId)` is called; if the token is missing or expires in under 30 s, it transparently calls `POST /api/token` and deduplicates concurrent refreshes via an inflight promise. `src/lib/pod-fetch.ts` wraps this into `podFetch()` and `podWsUrl()`.

### Dev mode

Set `DEV_MODE=true` to enable `/auth/dev`. Five test accounts with fixed UUIDs (`00000000-0000-0000-0000-00000000000{1–5}`) are defined in `src/lib/server/dev/seed-accounts.ts`. Run `pnpm db:seed:dev` to insert them. The dev login endpoint validates all three conditions before creating a session: `DEV_MODE=true`, UUID is in the allowlist, and the user row exists in the database.

### OIDC authentication

`src/lib/server/auth/oidc.ts` uses `openid-client` v6 directly (no lucia, authjs, or better-auth). Providers activate when both `{PROVIDER}_CLIENT_ID` and `{PROVIDER}_CLIENT_SECRET` env vars are present. GitHub requires manual OAuth2 config (no OIDC discovery). Account linking is email-based: same email across providers merges to one user.

## Environment variables

Key variables the web app reads at runtime:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `APP_URL` | yes | Public base URL (for OIDC redirect URIs) |
| `AGENT_IMAGE` | yes | Docker image for project pods |
| `GATEWAY_NAME` | yes | Name of the Gateway API Gateway resource |
| `GATEWAY_NAMESPACE` | yes | Namespace of the gateway |
| `GATEWAY_HOSTNAME` | yes | Hostname the gateway serves |
| `GOOGLE_CLIENT_ID` / `_SECRET` | no | Enables Google OIDC |
| `MICROSOFT_CLIENT_ID` / `_SECRET` | no | Enables Microsoft OIDC |
| `GITHUB_CLIENT_ID` / `_SECRET` | no | Enables GitHub OAuth2 |
| `DEV_MODE` | no | Set to `true` to enable `/auth/dev` |
| `K8S_JWT_PRIVATE_KEY` | no | Base64 PKCS8 PEM; generate ephemeral key if absent |
| `DEFAULT_IDLE_TIMEOUT_SECONDS` | no | Default 1800 |
| `AGENT_STORAGE_CLASS` | no | PVC storage class (default: `standard`) |
| `METRICS_SIDECAR_IMAGE` | no | Enables metrics sidecar in pods |
| `METRICS_PUSH_URL` | no | VictoriaMetrics push endpoint |

The Rust agent reads: `PORT`, `JWKS_URL`, `PROJECT_ID`, `WORKSPACE_PATH`, `IDLE_TIMEOUT_SECONDS`.

## Versioning and releases

The canonical version lives in the root `VERSION` file. Releases are created by triggering the `release` workflow manually (`workflow_dispatch`) from the `main` branch. It:
1. Runs all three check jobs
2. Analyses conventional commits since the last `v*.*.*` tag to determine the bump (`feat!`/`BREAKING CHANGE` → major, `feat` → minor, else patch)
3. Updates `VERSION`, `apps/web/package.json`, `apps/agent/Cargo.toml` (via `tomlkit`), and `apps/metrics-sidecar/version.go`
4. Commits, tags, and pushes — then builds all three Docker images from the tag and creates a GitHub Release

The `bump` input can override auto-detection.
