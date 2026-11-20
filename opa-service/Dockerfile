FROM golang:1.24-alpine AS builder

ENV GOTOOLCHAIN=go1.26.0
WORKDIR /src/opa-service

COPY opa-service/go.mod opa-service/go.sum ./
RUN go mod download

COPY opa-service/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/opa-service ./cmd/server

FROM alpine:3.20

RUN apk add --no-cache ca-certificates
WORKDIR /app

COPY --from=builder /out/opa-service /usr/local/bin/opa-service
COPY opa-service/config/opa-config.yaml ./config/opa-config.yaml
COPY opa-service/policies/ ./policies/

ENV OPA_CONFIG_PATH=/app/config/opa-config.yaml
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/opa-service"]
