FROM --platform=$BUILDPLATFORM golang:1.26.4 AS builder
WORKDIR /build
COPY apps/hubble-collector/ ./

ARG TARGETOS=linux
ARG TARGETARCH=amd64

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o hubble-collector .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -u 1000 -s /bin/sh -m collector

USER 1000

COPY --from=builder /build/hubble-collector /usr/local/bin/hubble-collector

ENTRYPOINT ["/usr/local/bin/hubble-collector"]
