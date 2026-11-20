# Stage 1: Build Go OPA binary
FROM golang:1.26-alpine AS builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/opa-server ./cmd/server

# Stage 2: Minimal runtime image
FROM alpine:3.23
RUN apk add --no-cache ca-certificates wget
WORKDIR /app

COPY --from=builder /out/opa-server /app/opa-server
COPY config ./config
COPY policies ./policies

ENV OPA_CONFIG_PATH=/app/config/opa-config.yaml
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/app/opa-server"]
