# Project Architecture & Coding Standards

You are building `cf_ai_policy_as_code`, an AI-assisted Policy-as-Code control plane on Cloudflare.

## Stack & Conventions
1. **Go OPA Backend (`/opa-service`)**:
   - Use Go 1.24+ and the embedded Open Policy Agent SDK (`github.com/open-policy-agent/opa/v1/rego`).
   - All Rego policies MUST start with `package authz` and `import rego.v1` (Rego v1 syntax: `if`, `contains`, `in`).
   - Expose HTTP endpoints on `:8080`: `POST /policies/sync`, `POST /validate`, and `POST /evaluate`.
2. **Cloudflare Edge Gateway & State (`/worker`)**:
   - Use TypeScript with `wrangler.jsonc` (not `wrangler.toml`).
   - Use **Durable Objects with SQLite storage** (`this.ctx.storage.sql`) to persist Rego policy versions, audit logs, and chat history.
   - Use **Workers AI** (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) and **Cloudflare Workflows** for the Rego generation -> OPA `/validate` -> auto-repair loop.
3. **Frontend (`/frontend`)**:
   - Single-page React + Vite + TypeScript app deployable to Cloudflare Pages.
   - Keep UI clean with role simulation, live Rego editor/diff, audit log viewer, and streaming AI Policy Copilot chat.
