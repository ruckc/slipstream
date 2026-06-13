FROM lukemathwalker/cargo-chef:latest-rust-slim@sha256:43ee9436c9b0c5c6631931a0f891233bb819261b02dab12646709d8bd8d74bdd AS chef
WORKDIR /build

FROM chef AS planner
COPY apps/metrics-collector/Cargo.toml apps/metrics-collector/Cargo.lock ./
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
ARG SCCACHE_VERSION=0.10.0
ARG SCCACHE_SHA256=1fbb35e135660d04a2d5e42b59c7874d39b3deb17de56330b25b713ec59f849b
# cmake is required by aws-lc-sys (pulled in by some rustls/reqwest feature combinations)
RUN apt-get update && apt-get install -y --no-install-recommends curl cmake && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://github.com/mozilla/sccache/releases/download/v${SCCACHE_VERSION}/sccache-v${SCCACHE_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    -o /tmp/sccache.tar.gz \
    && echo "${SCCACHE_SHA256}  /tmp/sccache.tar.gz" | sha256sum -c - \
    && tar -xz -C /tmp -f /tmp/sccache.tar.gz \
    && mv "/tmp/sccache-v${SCCACHE_VERSION}-x86_64-unknown-linux-musl/sccache" /usr/local/bin/sccache \
    && rm /tmp/sccache.tar.gz

ENV RUSTC_WRAPPER=sccache

COPY --from=planner /build/recipe.json recipe.json
RUN --mount=type=secret,id=actions_cache_url \
    --mount=type=secret,id=actions_runtime_token \
    --mount=type=cache,target=/root/.cache/sccache \
    SCCACHE_GHA_ENABLED=${SCCACHE_GHA_ENABLED:-false} \
    ACTIONS_CACHE_URL=$(cat /run/secrets/actions_cache_url 2>/dev/null || true) \
    ACTIONS_RUNTIME_TOKEN=$(cat /run/secrets/actions_runtime_token 2>/dev/null || true) \
    cargo chef cook --release --recipe-path recipe.json

COPY apps/metrics-collector/Cargo.toml apps/metrics-collector/Cargo.lock ./
COPY apps/metrics-collector/src ./src
RUN --mount=type=secret,id=actions_cache_url \
    --mount=type=secret,id=actions_runtime_token \
    --mount=type=cache,target=/root/.cache/sccache \
    SCCACHE_GHA_ENABLED=${SCCACHE_GHA_ENABLED:-false} \
    ACTIONS_CACHE_URL=$(cat /run/secrets/actions_cache_url 2>/dev/null || true) \
    ACTIONS_RUNTIME_TOKEN=$(cat /run/secrets/actions_runtime_token 2>/dev/null || true) \
    rm -f target/release/metrics-collector && \
    rm -rf target/release/.fingerprint/slipstream-metrics-collector-* && \
    cargo build --release && \
    # Guard against cargo-chef stub binaries being published: the real binary
    # is several MB; anything under 1 MB is a stub from a failed/cached build.
    test $(stat -c%s target/release/metrics-collector) -gt 1048576 || \
      { echo "ERROR: metrics-collector binary is suspiciously small (stub build?)" >&2; exit 1; }

FROM debian:13.5-slim@sha256:4e401d95de7083948053197a9c3913343cd06b706bf15eb6a0c3ccd26f436a0e
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 1000 collector && useradd -u 1000 -g collector -s /bin/sh -m collector
USER 1000
COPY --from=builder /build/target/release/metrics-collector /usr/local/bin/metrics-collector
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/metrics-collector"]
