FROM lukemathwalker/cargo-chef:latest-rust-slim@sha256:43ee9436c9b0c5c6631931a0f891233bb819261b02dab12646709d8bd8d74bdd AS chef
WORKDIR /build

FROM chef AS planner
COPY apps/agent/Cargo.toml apps/agent/Cargo.lock ./
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
# Install sccache from a pre-built binary to avoid a slow cargo-install step
ARG SCCACHE_VERSION=0.10.0
ARG SCCACHE_SHA256=1fbb35e135660d04a2d5e42b59c7874d39b3deb17de56330b25b713ec59f849b
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://github.com/mozilla/sccache/releases/download/v${SCCACHE_VERSION}/sccache-v${SCCACHE_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    -o /tmp/sccache.tar.gz \
    && echo "${SCCACHE_SHA256}  /tmp/sccache.tar.gz" | sha256sum -c - \
    && tar -xz -C /tmp -f /tmp/sccache.tar.gz \
    && mv "/tmp/sccache-v${SCCACHE_VERSION}-x86_64-unknown-linux-musl/sccache" /usr/local/bin/sccache \
    && rm /tmp/sccache.tar.gz

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

FROM debian:13.5-slim@sha256:4e401d95de7083948053197a9c3913343cd06b706bf15eb6a0c3ccd26f436a0e
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash build-essential ca-certificates curl docker.io dnsutils git git-lfs gpg htop iproute2 lsof procps tini tmux \
    && install -dm 755 /etc/apt/keyrings \
    && curl -fSs --retry 5 --retry-delay 2 https://mise.jdx.dev/gpg-key.pub | tee /etc/apt/keyrings/mise-archive-keyring.asc > /dev/null \
    && echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.asc] https://mise.jdx.dev/deb stable main" > /etc/apt/sources.list.d/mise.list \
    && KUBECTL_MINOR=$(curl -fsSL --retry 5 --retry-delay 2 https://dl.k8s.io/release/stable.txt | grep -oP 'v\d+\.\d+') \
    && curl -fsSL --retry 5 --retry-delay 2 "https://pkgs.k8s.io/core:/stable:/${KUBECTL_MINOR}/deb/Release.key" \
       | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/${KUBECTL_MINOR}/deb/ /" \
       > /etc/apt/sources.list.d/kubernetes.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends kubectl mise \
    && rm -rf /var/lib/apt/lists/* \
    && mise activate bash > /etc/profile.d/mise.sh
RUN groupadd -g 1000 agent && useradd -u 1000 -g agent -s /bin/bash -m agent
# /home/agent is a PVC mount at runtime — put shell config in /etc/profile.d
# so it is sourced by interactive bash regardless of the home volume contents.
RUN printf '%s\n' \
    'force_color_prompt=yes' \
    'alias ls="ls --color=auto"' \
    'alias grep="grep --color=auto"' \
    'alias ll="ls -lah --color=auto"' \
    '__osc7() { printf "\033]7;file://%s%s\007" "$HOSTNAME" "$PWD"; }' \
    '__set_title() { printf "\033]2;bash\007"; }' \
    '__ps=0' \
    'trap '\''(( __ps == 0 )) && printf "\033]2;%s\007" "$BASH_COMMAND"'\'' DEBUG' \
    'PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND;}__ps=1;__osc7;__set_title;__ps=0"' \
    > /etc/profile.d/slipstream.sh
RUN printf '%s\n' \
    'if [ -n "${WORKSPACE_NAMESPACE:-}" ] && [ -f /var/run/secrets/kubernetes.io/serviceaccount/token ]; then' \
    '  mkdir -p "$HOME/.kube"' \
    '  printf "apiVersion: v1\nkind: Config\nclusters:\n- name: in-cluster\n  cluster:\n    server: https://%s:%s\n    certificate-authority: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt\ncontexts:\n- name: default\n  context:\n    cluster: in-cluster\n    user: sa\n    namespace: %s\ncurrent-context: default\nusers:\n- name: sa\n  user:\n    tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token\n" \' \
    '    "$KUBERNETES_SERVICE_HOST" "$KUBERNETES_SERVICE_PORT" "$WORKSPACE_NAMESPACE" > "$HOME/.kube/config"' \
    'fi' \
    > /etc/profile.d/kubectl.sh
RUN mkdir -p /workspace && chown agent:agent /workspace
USER 1000
WORKDIR /workspace
COPY --from=builder /build/target/release/agent /usr/local/bin/agent
# DOCKER_HOST points at the buildkitd socket served by the moby/buildkit:rootless
# sidecar container. The socket is shared via a "buildkit" emptyDir volume mounted
# at /var/run/buildkit in both containers.
ENV WORKSPACE_PATH=/workspace \
    DOCKER_HOST=unix:///var/run/buildkit/buildkitd.sock
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/agent"]
