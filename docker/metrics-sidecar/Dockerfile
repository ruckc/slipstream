# Use BUILDPLATFORM for the compiler stage so the Go toolchain always runs
# natively; TARGETOS/TARGETARCH drive cross-compilation via GOOS/GOARCH.
FROM --platform=$BUILDPLATFORM golang:1.26.4 AS builder
WORKDIR /build

ARG TARGETOS=linux
ARG TARGETARCH=amd64

COPY apps/metrics-sidecar/go.mod ./
COPY apps/metrics-sidecar/ ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o metrics-sidecar .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      procps \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -u 1000 -s /bin/sh -m metrics

USER 1000

COPY --from=builder /build/metrics-sidecar /usr/local/bin/metrics-sidecar

ENV PUSH_INTERVAL=30
ENV WORKSPACE_PATH=/workspace

ENTRYPOINT ["/usr/local/bin/metrics-sidecar"]
