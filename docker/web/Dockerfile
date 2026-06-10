# ── Stage 1: Install all dependencies (for build) ─────────────────────────────
FROM node:lts-alpine AS deps
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @slipstream/web...

# ── Stage 1b: Install production-only dependencies (for runtime) ───────────────
FROM node:lts-alpine AS prod-deps
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @slipstream/web...

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:lts-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

COPY package.json pnpm-workspace.yaml VERSION ./
COPY apps/web ./apps/web

RUN pnpm --filter @slipstream/web build

# Ensure the drizzle migrations directory exists (it may be empty before first generation)
RUN mkdir -p apps/web/drizzle

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:lts-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S slipstream \
 && adduser  -u 1001 -S slipstream -G slipstream

# Preserve the pnpm workspace layout so the symlinks inside apps/web/node_modules
# (which point to ../../../node_modules/.pnpm/...) resolve to the virtual store
# copied here at /app/node_modules/.pnpm.
COPY --from=prod-deps --chown=slipstream:slipstream /app/node_modules /app/node_modules
COPY --from=prod-deps --chown=slipstream:slipstream /app/apps/web/node_modules /app/apps/web/node_modules

# The build output lives at /app/apps/web/build so that Node's upward module
# resolution from build/server/chunks/ passes through /app/apps/web/node_modules
# and finds @sveltejs/kit there.
COPY --from=builder --chown=slipstream:slipstream /app/apps/web/build /app/apps/web/build
COPY --from=builder --chown=slipstream:slipstream /app/apps/web/migrate.mjs /app/apps/web/migrate.mjs
COPY --from=builder --chown=slipstream:slipstream /app/apps/web/seed.mjs /app/apps/web/seed.mjs
COPY --from=builder --chown=slipstream:slipstream /app/apps/web/drizzle /app/apps/web/drizzle

USER slipstream

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

# Run from the web workspace directory so `node build` resolves to apps/web/build/index.js
# and module resolution walks up through /app/apps/web/node_modules.
WORKDIR /app/apps/web
CMD ["node", "build"]
