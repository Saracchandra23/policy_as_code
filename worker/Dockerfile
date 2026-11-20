FROM node:22-alpine

WORKDIR /app

COPY worker/package.json worker/package-lock.json ./
RUN npm ci

COPY worker/src ./src
COPY worker/worker-configuration.d.ts ./
COPY worker/wrangler.compose.jsonc ./wrangler.jsonc

ENV WRANGLER_SEND_METRICS=false
EXPOSE 8787

CMD ["sh", "-c", "exec npx wrangler dev --config /app/wrangler.jsonc --ip 0.0.0.0 --port 8787 --var \"OPA_SERVICE_URL:${OPA_SERVICE_URL:-http://127.0.0.1:8080}\""]
