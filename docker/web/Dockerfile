# ── Stage 1: Install dependencies ─────────────────────────────────────────────
# Separate stage so package installs are cached independently of source changes.
FROM node:lts-alpine AS deps
WORKDIR /app
RUN corepack enable

# Copy workspace manifests first to maximise layer cache hits
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

# Install only the packages needed for the web app (and its workspace deps)
RUN pnpm install --frozen-lockfile --filter @slipstream/web...

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:lts-alpine AS builder
WORKDIR /app
RUN corepack enable

# Reuse the installed node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy workspace root and app source
COPY package.json pnpm-workspace.yaml ./
COPY apps/web ./apps/web

# svelte-kit sync is run as part of the build script
RUN pnpm --filter @slipstream/web build

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
# adapter-node produces a self-contained build/ directory — no node_modules needed.
FROM node:lts-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S slipstream \
 && adduser  -u 1001 -S slipstream -G slipstream

COPY --from=builder --chown=slipstream:slipstream /app/apps/web/build ./build

USER slipstream

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["node", "build"]
