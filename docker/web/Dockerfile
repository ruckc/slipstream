# ── Stage 1: Install all dependencies (for build) ─────────────────────────────
FROM node:lts-alpine AS deps
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter @slipstream/web...

# ── Stage 1b: Install production-only dependencies (for runtime) ───────────────
FROM node:lts-alpine AS prod-deps
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

# --prod omits devDependencies; adapter-node leaves @sveltejs/kit external so it
# must be present at runtime even though the build/ directory looks self-contained.
RUN pnpm install --frozen-lockfile --prod --filter @slipstream/web...

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:lts-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

COPY package.json pnpm-workspace.yaml ./
COPY apps/web ./apps/web

RUN pnpm --filter @slipstream/web build

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:lts-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S slipstream \
 && adduser  -u 1001 -S slipstream -G slipstream

COPY --from=prod-deps --chown=slipstream:slipstream /app/node_modules ./node_modules
COPY --from=prod-deps --chown=slipstream:slipstream /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=slipstream:slipstream /app/apps/web/build ./build

USER slipstream

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["node", "build"]
