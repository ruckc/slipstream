# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Monorepo managed with pnpm workspaces (`pnpm-workspace.yaml`).

```
apps/
  web/                  # SvelteKit 5 + Svelte 5 — the main web application
  agent/                # Rust — HTTP service that runs inside each project pod
  metrics-collector/    # Rust — scrapes /metrics from each agent pod, stores usage samples in Postgres
  project-controller/   # Go — Kubernetes operator that reconciles ProjectEnvironment CRs
  hubble-collector/     # Go — reads Cilium/Hubble network flows, writes to Postgres
charts/
  slipstream/           # Helm chart for the full stack
docker/
  web/                  # Dockerfile for the SvelteKit app
  agent/                # Dockerfile for the Rust agent
  metrics-collector/    # Dockerfile for the Rust metrics collector
  project-controller/   # Dockerfile for the k8s operator
  hubble-collector/     # Dockerfile for the Hubble collector
tests/
  e2e/                  # Playwright end-to-end tests against the dev cluster
.github/workflows/
  ci.yml                # checks + build + sign + release on push to main / PR
  checks.yml            # reusable: format, lint, types, cargo-audit, pnpm-audit, govulncheck
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
mise run format:go       # gofmt (apps/project-controller, apps/hubble-collector)

# Linting / type-checking
mise run lint            # all linters
mise run lint:web        # Prettier check + ESLint (apps/web)
mise run typecheck:web   # svelte-check (apps/web)
mise run lint:rust       # cargo fmt --check + clippy (apps/agent)
mise run lint:go         # gofmt check + go vet (apps/project-controller, apps/hubble-collector)
mise run lint:helm       # helm lint

# Dependency auditing (also run by the pre-commit hook)
mise run audit           # pnpm audit --audit-level=high (matches CI npm-audit job)

# Testing
mise run test:e2e        # Playwright e2e tests against dev cluster (BASE_URL defaults to http://localhost)

# Local dev cluster (kind + registry)
mise run dev:cluster     # idempotent: kind cluster + registry + Gateway API CRDs + any cluster config
mise run dev:build       # build all images and push to localhost:5001 (tag: local)
mise run dev:build web   # build a single image (web | agent | metrics-collector | project-controller | hubble-collector)

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
go build ./...           # run from apps/project-controller/ or apps/hubble-collector/
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
  metricsCollector:
    repository: localhost:5001/slipstream-metrics-collector
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

The slugs `api`, `auth`, `admin`, `env`, `health`, `metrics`, `static`, `_app`, and any slug starting with `kube-` are reserved and rejected at registration time.

Each **project** gets its own dedicated Kubernetes namespace (`project-{projectId}`). All project resources (Pod, Service, HTTPRoute, NetworkPolicy, PVC, `ProjectEnvironment` CR) live in that namespace. Deleting the namespace cascades all non-PVC resources automatically.

### Project lifecycle

Projects are managed via a `ProjectEnvironment` custom resource (CRD group `slipstream.io/v1alpha1`). **There is no `status` field in the DB** — project status is derived on-demand from the CR's `.status.phase` field: `Pending`, `Provisioning`, `Running`, `Stopping`, `Stopped`, or `Error`.

The **project-controller** (`apps/project-controller/`) is a Kubernetes operator that watches `ProjectEnvironment` CRs and reconciles the actual pod, service, HTTPRoute, and NetworkPolicy resources. The web app sets `spec.desiredState` (`running` | `stopped`) on the CR; the controller drives the cluster toward that state.

**Idle shutdown** is handled by the project-controller's idle loop (`apps/project-controller/internal/controller/idle.go`), which scrapes `slipstream_last_activity_at` directly from each running pod's `/metrics` endpoint, identifies projects whose last activity exceeds their idle timeout, and patches `spec.desiredState = stopped`.

PVCs are never deleted when a project stops — only when a project is explicitly deleted.

Idle timeout resolution priority: `project.idleTimeoutSeconds` → `org/user.idleTimeoutSeconds` → `DEFAULT_IDLE_TIMEOUT_SECONDS` env var (default 1800 s).

The web app interacts with `ProjectEnvironment` CRs via `src/lib/server/k8s/cr.ts` (`createProjectEnvironment`, `getProjectEnvironment`, `patchProjectEnvironmentSpec`, `patchEgressPolicy`, `deleteProjectEnvironment`, `phaseToProjectStatus`). All functions validate `projectId` against a UUID regex before making any K8s API calls.

### Project pod filesystem layout

Each project pod has three volume mounts:

| Path | Type | Notes |
|---|---|---|
| `/workspace` | PVC | Persistent workspace — survives stop/start cycles |
| `/home/agent` | PVC | Persistent home directory — survives stop/start cycles |
| `/tmp` | emptyDir | Ephemeral scratch space |

**Important**: `/home/agent` is a PVC that mounts over the image's home directory at runtime, hiding any files baked into the image at that path. Shell configuration, aliases, and other per-session setup must go in `/etc/profile.d/` (sourced by every `bash -l` login shell), **not** in `/home/agent/.bashrc` or `/home/agent/.profile`.

Current `/etc/profile.d/` scripts in the agent image:
- `/etc/profile.d/mise.sh` — activates mise for all bash login shells
- `/etc/profile.d/slipstream.sh` — color prompt, ls/grep aliases, OSC 7 CWD reporting, terminal title updates
Container images are built inside project pods using the **Docker CLI** (`docker buildx build`) talking to a **moby/buildkit rootless sidecar** container. The sidecar runs BuildKit in rootless mode (`--oci-worker-no-process-sandbox`) and exposes a Unix socket at `/var/run/buildkit/buildkitd.sock`, shared with the agent container via an emptyDir volume. The agent image sets `DOCKER_HOST=unix:///var/run/buildkit/buildkitd.sock` so `docker buildx build --push` works without any daemon in the agent itself. The registry is always accessed via its public FQDN (`harbor.ruck.io`) which has a valid TLS certificate — no insecure configuration is needed. Typical flow in a pod terminal: `docker buildx build -t $REGISTRY_HOST/<namespace>/<project>/<img>:<tag> --push /workspace`.

### Egress policy

Each project has an egress policy embedded in its `ProjectEnvironment` CR spec (`spec.egressPolicy`). The policy is resolved from DB rules (namespace-level allow/deny rules + project-level allow rules) by `src/lib/server/k8s/egress.ts` and written to the CR when the project is created or its policy is updated. The project-controller enforces the policy via Cilium `NetworkPolicy` resources in the project namespace.

The **hubble-collector** (`apps/hubble-collector/`) connects to Cilium's Hubble Relay gRPC API and writes observed DNS, HTTP, and L4 flows to Postgres. This powers the network activity view in the project UI.

### Container registry

Users build container images inside their project pods using **`docker buildx build`** (Docker CLI + moby/buildkit rootless sidecar) and push them to a **Harbor** registry with **namespace-scoped isolation**: images pushed under namespace `alpha` can only be pulled by `alpha`.

Each Slipstream namespace maps to one **private Harbor project** (named after the slug). The web app provisions the project plus a project-scoped **robot account** (push+pull) on first project creation in that namespace (`src/lib/server/registry/harbor.ts`), persisting the robot credentials in the `namespace_registry` DB table (Harbor only returns a robot secret once). Harbor itself enforces isolation — a namespace's robot can only access its own private project.

Credential delivery to pods avoids granting the internet-facing web app any new cluster powers: the web app writes the robot credentials into the cluster-scoped `ProjectEnvironment` CR spec (`spec.registryAuth`), and the **project-controller** materializes them as a `kubernetes.io/dockerconfigjson` Secret (`slipstream-registry-auth`) in the project namespace, mounted read-only at `/etc/registry-auth` (and at `/home/user/.docker` in the buildkit sidecar) so both the Docker CLI and BuildKit pick up credentials without an interactive login. The pod NetworkPolicy is extended with egress to the Harbor namespace. (Storing the robot secret in the cluster-scoped CR spec is an accepted v1 tradeoff; encryption-at-rest is a hardening follow-up.)

Registry support is **optional** — it activates only when `registry.enabled` is set in the Helm values (env `HARBOR_URL` + `REGISTRY_HOST` present). When unset, projects are created without registry credentials and everything else works unchanged.

In local dev, `mise run dev:cluster` installs **rustfs** (a Rust S3 server) in the `harbor` namespace and deploys Harbor backed by it (`charts/harbor-dev-values.yaml`), reached in-cluster over HTTP (`REGISTRY_INSECURE=true`).

### JWT issuance

`src/lib/server/jwt/keys.ts` manages an RS256 keypair — ephemeral in-memory for single-replica dev, or loaded from the `K8S_JWT_PRIVATE_KEY` env var (base64 PKCS8 PEM) for multi-replica. The pod fetches the JWKS from `http://slipstream-web.slipstream-system.svc.cluster.local/api/jwks` on startup and caches with a 5-minute TTL, with a 30-minute hard expiry (after which a failed refresh causes token rejection rather than accepting stale keys). The NetworkPolicy explicitly allows this egress from pods.

JWT claims: `{ sub: userId, projectId, permissions: string[], exp, iat }`. The agent enforces permissions per route: `files:read` for downloads/listing, `files:write` for upload/delete/mkdir, `shell` for PTY sessions.

The `?token=` query parameter is accepted **only** on WebSocket routes (where browsers can't set custom headers). All non-WebSocket routes require `Authorization: Bearer` header only.

### Permission model

Four independent permission bits: `files:read`, `files:write`, `shell`, `project:manage`. Resolution rules in `src/lib/server/permissions.ts`:
1. User-namespace owner → all permissions on their own projects
2. Org owner → all permissions on all org projects
3. Explicit `project_permissions` row for the user
4. Explicit `project_permissions` row for any org the user belongs to

Admin-only remote functions (`listUsers`, `setUserRole`, `getDashboardStats`, `getErrors`, `getErrorRoutes`) check `locals.user.role === 'admin'` via `requireAdmin()` at the top of each function. `ADMIN_EMAILS` auto-promotion is audit-logged.

### Sessions

Sessions are stored in a `sessions` DB table (id, userId, expiresAt, lastActiveAt, createdAt). On each validated request, `lastActiveAt` is updated if more than 60 seconds have passed since the last update (debounced to avoid per-request writes). Sessions are rejected if `lastActiveAt` is older than `SESSION_INACTIVITY_TIMEOUT_SECONDS` (default 28800 / 8 hours). Logout deletes the DB row immediately.

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

`src/lib/token-store.ts` holds a per-project token cache. Before any request to a pod, `tokenStore.get(projectId)` is called; if the token is missing or expires in under 30 s, it transparently calls `POST /api/token` and deduplicates concurrent refreshes via an inflight promise. `src/lib/pod-fetch.ts` wraps this into `podFetch()` and `podWsUrl()`. The token cache is cleared on logout.

### Dev mode

Set `DEV_MODE=true` to enable `/auth/dev`. Five test accounts with fixed UUIDs (`00000000-0000-0000-0000-00000000000{1–5}`) are defined in `src/lib/server/dev/seed-accounts.ts`. Run `pnpm db:seed:dev` to insert them. The dev login endpoint validates all three conditions before creating a session: `DEV_MODE=true`, UUID is in the allowlist, and the user row exists in the database.

### OIDC authentication

`src/lib/server/auth/oidc.ts` uses `openid-client` v6 directly (no lucia, authjs, or better-auth). Providers activate when both `{PROVIDER}_CLIENT_ID` and `{PROVIDER}_CLIENT_SECRET` env vars are present. GitHub requires manual OAuth2 config (no OIDC discovery). Account linking is email-based: same email across providers merges to one user.

## Environment variables

Key variables the web app reads at runtime:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string; `sslmode=require` is appended automatically in production if absent |
| `APP_URL` | yes | Public base URL (for OIDC redirect URIs); also passed to agent pods as `CORS_ORIGIN` |
| `AGENT_IMAGE` | yes (controller) | Docker image for project pods — read by project-controller, not web |
| `GATEWAY_NAME` | yes (controller) | Name of the Gateway API Gateway resource — read by project-controller |
| `GATEWAY_NAMESPACE` | yes (controller) | Namespace of the gateway — read by project-controller |
| `GATEWAY_HOSTNAME` | yes (controller) | Hostname the gateway serves — read by project-controller |
| `GOOGLE_CLIENT_ID` / `_SECRET` | no | Enables Google OIDC |
| `MICROSOFT_CLIENT_ID` / `_SECRET` | no | Enables Microsoft OIDC |
| `GITHUB_CLIENT_ID` / `_SECRET` | no | Enables GitHub OAuth2 |
| `SESSION_SECRET` | yes (prod) | HMAC-SHA256 key for signing session cookies; falls back to a hardcoded dev value if unset |
| `SESSION_INACTIVITY_TIMEOUT_SECONDS` | no | Session inactivity timeout (default: 28800 / 8h) |
| `DEV_MODE` | no | Set to `true` to enable `/auth/dev` |
| `K8S_JWT_PRIVATE_KEY` | no | Base64 PKCS8 PEM; generate ephemeral key if absent |
| `DEFAULT_IDLE_TIMEOUT_SECONDS` | no | Default 1800 |
| `AGENT_STORAGE_CLASS` | no | PVC storage class (default: `standard`) |
| `HARBOR_URL` | no | Harbor API base URL; enables the registry integration when set (with `REGISTRY_HOST`) |
| `HARBOR_ADMIN_USERNAME` / `HARBOR_ADMIN_PASSWORD` | no | Harbor admin creds for provisioning projects/robots (`_PASSWORD` is a Secret) |
| `REGISTRY_HOST` | no | Registry host (host[:port]) used in image references and the pods' docker config |
The Rust agent reads: `PORT`, `JWKS_URL` (required; must be http/https URL), `PROJECT_ID`, `WORKSPACE_PATH`, `HOME_PATH`, `IDLE_TIMEOUT_SECONDS`, `CORS_ORIGIN` (required — agent exits at startup if unset), `METRICS_TOKEN` (optional; if set, `/metrics` requires `Authorization: Bearer <token>`; if unset, `/metrics` returns 403). Registry-related env injected into pods by the controller (only when the namespace has registry credentials): `REGISTRY_HOST`, `REGISTRY_INSECURE` (dev), and `DOCKER_HOST` (baked into image, points at buildkit sidecar socket).

The project-controller additionally reads: `USAGE_REPORT_URL` (optional, for usage telemetry), `KUBECONFIG` (optional, falls back to in-cluster config), `HARBOR_NAMESPACE` (grants pods egress to Harbor), `REGISTRY_INSECURE` (`true` in dev so docker buildx treats REGISTRY_HOST as insecure), `BUILDKIT_IMAGE` (defaults to pinned moby/buildkit digest).

The hubble-collector reads: `HUBBLE_RELAY_ADDRESS` (default: `hubble-relay.kube-system.svc.cluster.local:4245`; must be `host:port` format, no URL scheme), `DATABASE_URL`.

## Security notes

- **Admin guards**: All admin remote functions call `requireAdmin()` which checks `locals.user.role === 'admin'`. Never add admin operations without this guard.
- **Path safety**: `safe_path()` in `apps/agent/src/fs.rs` rejects `..` components and canonicalizes parent directories for non-existent paths. Always route file operations through this function.
- **Reserved slugs**: `api`, `auth`, `admin`, `env`, `health`, `metrics`, `static`, `_app`, and `kube-*` prefixed slugs are blocked at registration — enforced in both `organization.remote.ts` and `project.remote.ts`.
- **Security headers**: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, and `Content-Security-Policy` are set in `src/hooks.server.ts` on every response.
- **Supply chain**: All GitHub Actions are pinned to commit SHAs. All Docker base images use digest pins. Docker images are signed with cosign (keyless via GitHub Actions OIDC). CI runs `cargo audit`, `pnpm audit --audit-level=high`, and `govulncheck` on every push.

## Versioning and releases

The canonical version lives in the root `VERSION` file. Releases are created by triggering the `release` workflow manually (`workflow_dispatch`) from the `main` branch. It:
1. Runs all check jobs (format, lint, types, audit)
2. Analyses conventional commits since the last `v*.*.*` tag to determine the bump (`feat!`/`BREAKING CHANGE` → major, `feat` → minor, else patch)
3. Updates `VERSION`, `apps/web/package.json`, `apps/agent/Cargo.toml` and `apps/metrics-collector/Cargo.toml` (via `tomlkit`), and `version.go` in all Go services (`project-controller`, `hubble-collector`)
4. Commits, tags, and pushes — then builds all Docker images from the tag, signs them with cosign, and creates a GitHub Release with the Helm chart attached

The `bump` input can override auto-detection.
