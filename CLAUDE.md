# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Monorepo managed with pnpm workspaces (`pnpm-workspace.yaml`).

```
apps/
  web/                  # SvelteKit 5 + Svelte 5 — the main web application
  agent/                # Rust — HTTP service that runs inside each project pod
  metrics-sidecar/      # Go — reads cgroup/proc metrics, pushes to VictoriaMetrics
  project-controller/   # Go — Kubernetes operator that reconciles ProjectEnvironment CRs
  hubble-collector/     # Go — reads Cilium/Hubble network flows, writes to Postgres
charts/
  slipstream/           # Helm chart for the full stack
docker/
  web/                  # Dockerfile for the SvelteKit app
  agent/                # Dockerfile for the Rust agent
  metrics-sidecar/      # Dockerfile for the Go sidecar
  project-controller/   # Dockerfile for the k8s operator
  hubble-collector/     # Dockerfile for the Hubble collector
tests/
  e2e/                  # Playwright end-to-end tests against the dev cluster
.github/workflows/
  ci.yml                # checks + edge image push on every push to main / PR
  release.yml           # manual workflow_dispatch — bumps version, tags, builds, publishes
```

## Commands

Prefer `mise run <task>` over calling tools directly. Leaf tasks live as executable scripts in `.mise/tasks/`; aggregator tasks (`format`, `lint`) are defined in `mise.toml` with `depends`.

```bash
# Install all workspace dependencies
pnpm install

# Formatting
mise run format          # all projects
mise run format:web      # Prettier (apps/web)
mise run format:rust     # rustfmt (apps/agent)
mise run format:go       # gofmt (apps/metrics-sidecar)

# Linting / type-checking
mise run lint            # all linters
mise run lint:web        # Prettier check + ESLint (apps/web)
mise run typecheck:web   # svelte-check (apps/web)
mise run lint:rust       # cargo fmt --check + clippy (apps/agent)
mise run lint:go         # gofmt check + go vet (apps/metrics-sidecar)
mise run lint:helm       # helm lint

# Testing
mise run test:e2e        # Playwright e2e tests against dev cluster (BASE_URL defaults to http://localhost)

# Local dev cluster (kind + registry)
mise run dev:cluster     # idempotent: kind cluster + registry + Gateway API CRDs + any cluster config
mise run dev:build       # build all images and push to localhost:5001 (tag: local)
mise run dev:build web   # build a single image (web | agent | metrics-sidecar | project-controller | hubble-collector)

# Kubernetes install (assumes cluster is already configured via dev:cluster or equivalent)
mise run install         # helm upgrade --install → wait for rollout → db migrate

# Git hooks
mise run hooks:install   # point core.hooksPath at .githooks/

# Web app (no mise task — run directly)
pnpm --filter @slipstream/web dev          # dev server
pnpm --filter @slipstream/web build        # production build

# Database (run from apps/web/ or use filter)
pnpm --filter @slipstream/web db:generate  # drizzle-kit generate migration
pnpm --filter @slipstream/web db:migrate   # apply migrations
pnpm --filter @slipstream/web db:seed:dev  # seed dev accounts (requires DATABASE_URL)

# Rust agent — build/test only (formatting/linting via mise)
cargo build              # run from apps/agent/
cargo build --release
cargo test

# Go services — build/test only (formatting/linting via mise)
go build ./...           # run from apps/metrics-sidecar/, apps/project-controller/, or apps/hubble-collector/
go test ./...
```

### Cluster install

`mise run dev:cluster` is the single place for all cluster-level setup. It runs in two phases: phase 1 creates the registry container and kind cluster (skipped if they already exist); phase 2 applies all cluster configuration via `kubectl apply` (always runs, idempotent). Add new cluster-level resources to phase 2 as they are discovered. Currently phase 2 configures: local registry discovery ConfigMap and Gateway API CRDs.

`mise run install` assumes the cluster is already configured. It runs `helm upgrade --install` against the local chart, waits for the web deployment to roll out, then applies DB migrations. It uses `charts/slipstream/values-dev.yaml` as the base and merges `charts/slipstream/values-local.yaml` on top if present.

`values-local.yaml` is gitignored. For a local kind cluster with the local registry, it should contain:

```yaml
# charts/slipstream/values-local.yaml
gateway:
  name: slipstream
  namespace: slipstream-system
  hostname: localhost

image:
  web:
    repository: localhost:5001/slipstream-web
    tag: local
  agent:
    repository: localhost:5001/slipstream-agent
    tag: local
  metricsSidecar:
    repository: localhost:5001/slipstream-metrics-sidecar
    tag: local
  projectController:
    repository: localhost:5001/slipstream-project-controller
    tag: local
```

The local dev workflow is:
```bash
mise run dev:cluster  # once: creates kind cluster + registry on localhost:5001
mise run dev:build    # on each change: builds and pushes all three images
mise run install      # deploys/upgrades via helm
```

## Architecture

### Request flow

The browser talks exclusively to the Gateway API. Two sets of HTTPRoutes exist for the same hostname:

- `/*` → SvelteKit web app (catch-all, lowest priority)
- `/env/{namespace-slug}/{project-slug}/*` → project pod (per-project HTTPRoute, prefix stripped before forwarding)

The SvelteKit server never proxies pod traffic — the gateway routes it directly. Every pod request carries a short-lived RS256 JWT (`Authorization: Bearer`) issued by the SvelteKit `/api/token` endpoint and validated by the Rust agent via the SvelteKit `/api/jwks` endpoint.

### Namespace model

Slugs are globally unique across users and orgs (enforced by a DB unique index on `namespaces.slug`). Kubernetes namespaces are prefixed: user `alice` → `u-alice`, org `acme` → `o-acme`. First registrant of a slug wins permanently.

Each **project** gets its own dedicated Kubernetes namespace (`project-{projectId}`). All project resources (Pod, Service, HTTPRoute, NetworkPolicy, PVC, `ProjectEnvironment` CR) live in that namespace. Deleting the namespace cascades all non-PVC resources automatically.

### Project lifecycle

Projects are managed via a `ProjectEnvironment` custom resource (CRD group `slipstream.io/v1alpha1`). **There is no `status` field in the DB** — project status is derived on-demand from the CR's `.status.phase` field: `Pending`, `Provisioning`, `Running`, `Stopping`, `Stopped`, or `Error`.

The **project-controller** (`apps/project-controller/`) is a Kubernetes operator that watches `ProjectEnvironment` CRs and reconciles the actual pod, service, HTTPRoute, and NetworkPolicy resources. The web app sets `spec.desiredState` (`running` | `stopped`) on the CR; the controller drives the cluster toward that state.

**Idle shutdown** is handled by the project-controller's idle loop (`apps/project-controller/internal/controller/idle.go`), which polls VictoriaMetrics for `slipstream_last_activity_at`, identifies projects whose last activity exceeds their idle timeout, and patches `spec.desiredState = stopped`. This only runs when `METRICS_PUSH_URL` is set.

PVCs are never deleted when a project stops — only when a project is explicitly deleted.

Idle timeout resolution priority: `project.idleTimeoutSeconds` → `org/user.idleTimeoutSeconds` → `DEFAULT_IDLE_TIMEOUT_SECONDS` env var (default 1800 s).

The web app interacts with `ProjectEnvironment` CRs via `src/lib/server/k8s/cr.ts` (`createProjectEnvironment`, `getProjectEnvironment`, `patchProjectEnvironmentSpec`, `patchEgressPolicy`, `deleteProjectEnvironment`, `phaseToProjectStatus`).

### Egress policy

Each project has an egress policy embedded in its `ProjectEnvironment` CR spec (`spec.egressPolicy`). The policy is resolved from DB rules (namespace-level allow/deny rules + project-level allow rules) by `src/lib/server/k8s/egress.ts` and written to the CR when the project is created or its policy is updated. The project-controller enforces the policy via Cilium `NetworkPolicy` resources in the project namespace.

The **hubble-collector** (`apps/hubble-collector/`) connects to Cilium's Hubble Relay gRPC API and writes observed DNS, HTTP, and L4 flows to Postgres. This powers the network activity view in the project UI.

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

**Do not create `+page.server.ts` files.** This project uses SvelteKit's experimental remote functions exclusively — see https://svelte.dev/docs/kit/remote-functions. The config is already set in `svelte.config.js` (`kit.experimental.remoteFunctions: true`, `compilerOptions.experimental.async: true`).

Pages use `query`, `form`, and `command` remote functions instead of load functions and form actions.

**Route-level remote files** live as `<route>/*.remote.ts` (e.g. `src/routes/settings/settings.remote.ts`). They export `query`/`form`/`command` functions and are imported directly in `.svelte` components. Use `/remote-route` to convert a route.

**Shared remote functions** live in `src/lib/remote/*.remote.ts` as `query`/`command` wrappers. **Every export from a `.remote.ts` file must be a remote function** — plain async function exports cause a build error (`all exports from this file must be remote functions`). Keep plain async helpers as non-exported internal functions within the file. `query`/`command` each take at most one argument; pack multiple params into an object.

Key imports:
- `query`, `form`, `command`, `getRequestEvent` → `$app/server`
- `redirect`, `error`, `invalid` → `@sveltejs/kit`
- In components: `import { page } from '$app/state'` then `page.params.foo!` (no `$` prefix, non-null assert)
- Form field errors: `myForm.fields.fieldName?.issues()?.[0]?.message`

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
| `AGENT_IMAGE` | yes (controller) | Docker image for project pods — read by project-controller, not web |
| `GATEWAY_NAME` | yes (controller) | Name of the Gateway API Gateway resource — read by project-controller |
| `GATEWAY_NAMESPACE` | yes (controller) | Namespace of the gateway — read by project-controller |
| `GATEWAY_HOSTNAME` | yes (controller) | Hostname the gateway serves — read by project-controller |
| `GOOGLE_CLIENT_ID` / `_SECRET` | no | Enables Google OIDC |
| `MICROSOFT_CLIENT_ID` / `_SECRET` | no | Enables Microsoft OIDC |
| `GITHUB_CLIENT_ID` / `_SECRET` | no | Enables GitHub OAuth2 |
| `SESSION_SECRET` | yes (prod) | HMAC-SHA256 key for signing session cookies; falls back to a hardcoded dev value if unset |
| `DEV_MODE` | no | Set to `true` to enable `/auth/dev` |
| `K8S_JWT_PRIVATE_KEY` | no | Base64 PKCS8 PEM; generate ephemeral key if absent |
| `DEFAULT_IDLE_TIMEOUT_SECONDS` | no | Default 1800 |
| `AGENT_STORAGE_CLASS` | no | PVC storage class (default: `standard`) |
| `METRICS_SIDECAR_IMAGE` | no | Enables metrics sidecar in pods — read by project-controller |
| `METRICS_PUSH_URL` | no | VictoriaMetrics push endpoint — enables idle shutdown in controller |

The Rust agent reads: `PORT`, `JWKS_URL`, `PROJECT_ID`, `WORKSPACE_PATH`, `IDLE_TIMEOUT_SECONDS`, `CORS_ORIGIN` (passed automatically from `APP_URL`).

The project-controller additionally reads: `USAGE_REPORT_URL` (optional, for usage telemetry), `KUBECONFIG` (optional, falls back to in-cluster config).

## Versioning and releases

The canonical version lives in the root `VERSION` file. Releases are created by triggering the `release` workflow manually (`workflow_dispatch`) from the `main` branch. It:
1. Runs all three check jobs
2. Analyses conventional commits since the last `v*.*.*` tag to determine the bump (`feat!`/`BREAKING CHANGE` → major, `feat` → minor, else patch)
3. Updates `VERSION`, `apps/web/package.json`, `apps/agent/Cargo.toml` (via `tomlkit`), and `version.go` in all Go services (`metrics-sidecar`, `project-controller`, `hubble-collector`)
4. Commits, tags, and pushes — then builds all Docker images from the tag and creates a GitHub Release

The `bump` input can override auto-detection.
