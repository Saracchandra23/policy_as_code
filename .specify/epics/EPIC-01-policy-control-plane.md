# EPIC-01: AI-Assisted Policy-as-Code Control Plane on Cloudflare
- **Goal**: Build an end-to-end authorization control plane combining an embedded Go OPA Policy Decision Point (PDP), a Cloudflare Worker Policy Enforcement Point (PEP), Durable Object SQLite persistence, a self-correcting Llama 3.3 Cloudflare Workflow, and a React SPA.
- **Topics**:
  - `TOPIC-01`: Embedded Go OPA Singleton, External Config & Local Bundle Server (`specs/001-go-opa-singleton`)
  - `TOPIC-02`: Cloudflare Worker PEP, SQLite Durable Object & Llama 3.3 Authoring Workflow (`specs/002-cf-pep-workflow`)
  - `TOPIC-03`: Single-Page Policy Studio & Live Authorization Simulator (`specs/003-control-plane-spa`)
