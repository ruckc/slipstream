FROM lukemathwalker/cargo-chef:latest-rust-slim AS chef
WORKDIR /build

FROM chef AS planner
COPY apps/agent/Cargo.toml apps/agent/Cargo.lock ./
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
# Install sccache from a pre-built binary to avoid a slow cargo-install step
ARG SCCACHE_VERSION=0.10.0
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://github.com/mozilla/sccache/releases/download/v${SCCACHE_VERSION}/sccache-v${SCCACHE_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    | tar -xz -C /tmp \
    && mv "/tmp/sccache-v${SCCACHE_VERSION}-x86_64-unknown-linux-musl/sccache" /usr/local/bin/sccache

ENV RUSTC_WRAPPER=sccache

COPY --from=planner /build/recipe.json recipe.json
# Cook dependencies — this layer is only invalidated when Cargo.toml/Cargo.lock change
RUN --mount=type=secret,id=actions_cache_url \
    --mount=type=secret,id=actions_runtime_token \
    --mount=type=cache,target=/root/.cache/sccache \
    SCCACHE_GHA_ENABLED=${SCCACHE_GHA_ENABLED:-false} \
    ACTIONS_CACHE_URL=$(cat /run/secrets/actions_cache_url 2>/dev/null || true) \
    ACTIONS_RUNTIME_TOKEN=$(cat /run/secrets/actions_runtime_token 2>/dev/null || true) \
    cargo chef cook --release --recipe-path recipe.json

COPY apps/agent/Cargo.toml apps/agent/Cargo.lock ./
COPY apps/agent/src ./src
RUN --mount=type=secret,id=actions_cache_url \
    --mount=type=secret,id=actions_runtime_token \
    --mount=type=cache,target=/root/.cache/sccache \
    SCCACHE_GHA_ENABLED=${SCCACHE_GHA_ENABLED:-false} \
    ACTIONS_CACHE_URL=$(cat /run/secrets/actions_cache_url 2>/dev/null || true) \
    ACTIONS_RUNTIME_TOKEN=$(cat /run/secrets/actions_runtime_token 2>/dev/null || true) \
    cargo build --release

FROM debian:13.5-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash build-essential ca-certificates curl dnsutils git git-lfs gpg htop iproute2 lsof procps \
    && install -dm 755 /etc/apt/keyrings \
    && curl -fSs https://mise.en.dev/gpg-key.pub | tee /etc/apt/keyrings/mise-archive-keyring.asc > /dev/null \
    && echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.asc] https://mise.en.dev/deb stable main" > /etc/apt/sources.list.d/mise.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mise \
    && rm -rf /var/lib/apt/lists/* \
    && mise activate bash > /etc/profile.d/mise.sh
RUN groupadd -g 1000 agent && useradd -u 1000 -g agent -s /bin/bash -m agent
RUN sed -i 's/#force_color_prompt=yes/force_color_prompt=yes/' /home/agent/.bashrc \
    && printf "\nalias ls='ls --color=auto'\nalias grep='grep --color=auto'\nalias ll='ls -lah --color=auto'\n" >> /home/agent/.bashrc
RUN mkdir -p /workspace && chown agent:agent /workspace
USER 1000
WORKDIR /workspace
COPY --from=builder /build/target/release/agent /usr/local/bin/agent
ENV WORKSPACE_PATH=/workspace
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/agent"]
