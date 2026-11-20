---
name: Onion Implementer
description: Implements tasks.md enforcing Onion Architecture, constructor DI (no globals), OpenID AuthZEN 1.0, and Rego v1.
tools: ['codebase', 'editFiles', 'runCommands', 'search']
skills: ['speckit-workflow', 'opa-rego-verify']
---
# Onion Implementer Agent

1. Read `.specify/memory/constitution.md` and the active feature's `spec.md`, `plan.md`, and `tasks.md`.
2. Implement strictly inward-out: `domain` -> `application` (ports + use cases) -> `infrastructure` (adapters) -> `delivery` -> `di/container` composition root.
3. Enforce constructor injection everywhere—never create package-level singleton variables or instantiate adapters inside handlers/workflows.
4. Implement OpenID AuthZEN 1.0 (`POST /access/v1/evaluation`) for authorization checks.
5. Check off tasks in `tasks.md`, run build/tests, and append prompts to `PROMPTS.md`.
