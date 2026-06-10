FROM rust:latest AS builder
WORKDIR /build
COPY apps/agent/Cargo.toml ./
# Create empty src/main.rs for dependency caching
RUN mkdir src && echo 'fn main(){}' > src/main.rs
RUN cargo build --release
# Now copy real source
COPY apps/agent/src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:13.5-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash build-essential ca-certificates curl dnsutils htop lsof procps \
    && install -dm 755 /etc/apt/keyrings \
    && curl -fSs https://mise.en.dev/gpg-key.pub | tee /etc/apt/keyrings/mise-archive-keyring.asc > /dev/null \
    && echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.asc] https://mise.en.dev/deb stable main" > /etc/apt/sources.list.d/mise.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mise \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 1000 agent && useradd -u 1000 -g agent -s /bin/bash -m agent
RUN mkdir -p /workspace && chown agent:agent /workspace
USER 1000
WORKDIR /workspace
COPY --from=builder /build/target/release/agent /usr/local/bin/agent
ENV WORKSPACE_PATH=/workspace
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/agent"]
