---
name: speckit-workflow
description: Execute Spec-Kit artifact generation (spec.md, plan.md, tasks.md) and maintain PROMPTS.md traceability. Use when planning or implementing any Epic or Topic.
---
# Spec-Kit Workflow Skill

## Procedure
1. Read `.specify/memory/constitution.md` to load architectural and coding constraints.
2. Verify the parent Epic in `.specify/epics/` and Topic in `.specify/topics/`.
3. Generate or update `spec.md`, `plan.md`, and `tasks.md` inside `.specify/specs/<feature-id>/`.
4. Ensure every task in `tasks.md` specifies its Onion layer (`[Domain]`, `[Application]`, `[Infrastructure]`, `[Delivery]`).
5. Append a concise summary of the prompt and created artifacts to `PROMPTS.md`.
