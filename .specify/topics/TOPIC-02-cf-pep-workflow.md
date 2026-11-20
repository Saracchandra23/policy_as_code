# TOPIC-02: DI-Wired Cloudflare PEP, SQLite State & Llama 3.3 AuthZEN Workflow
- **Parent Epic**: `EPIC-01`
- **Scope**: Onion-layered TypeScript Worker (`worker/`) wired via `src/di/container.ts`, enforcing OpenID AuthZEN 1.0 evaluation requests via Durable Object SQLite state, running a multi-step Cloudflare Workflow (`Generate Rego v1 -> Go OPA /validate -> Auto-Repair`) with Llama 3.3, and explaining AuthZEN denials.
