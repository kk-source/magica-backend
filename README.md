# magica-backend

API + agent runtime for the Galaxy-style agent chat. Next.js (App Router, API routes only), Prisma/Postgres, Clerk, Trigger.dev, OpenRouter, Magica.

## Setup

```bash
pnpm install
cp .env.example .env        # fill in keys
pnpm db:migrate             # creates tables (prisma migrate dev)
pnpm dev                    # API on http://localhost:4000
pnpm trigger:dev            # in a second terminal: runs Trigger.dev tasks locally
```

## Layout

| Path | What |
|---|---|
| `app/api/chats/**` | REST routes (Zod-validated, Clerk-protected via `middleware.ts`) |
| `lib/contracts.ts` | Request/response schemas shared with the frontend |
| `lib/agent/loop.ts` | OpenRouter tool-calling loop, yields text + tool events |
| `lib/tools/` | Tool contracts: `crop_image`, `gpt_image_2`, `merge_videos`, `load_skill`, `read_skill_asset` |
| `lib/skills/registry.ts` | Scans `agent-skills/*/SKILL.md` frontmatter; bodies load lazily via `load_skill` |
| `trigger/agent-run.ts` | Trigger.dev task: runs the agent, streams via run metadata, persists the reply |
| `prisma/schema.prisma` | Data model |

## Flow

1. `POST /api/chats/:id/messages` with `{ content, attachments?, idempotencyKey? }` stores the user message, creates an `AgentRun`, triggers `agent-run`, and returns `{ message, runId }`.
2. The frontend polls `GET /api/chats/:id/runs/:runId` → `{ id, chatId, status, text, tools, error }`. While `STREAMING`, text comes live from the Trigger.dev run metadata.
3. On completion the assistant message is saved with status `COMPLETE` (or `FAILED` / `CANCELLED`).

The contract lives in `lib/contracts.ts` and mirrors the frontend's `lib/api/schemas.ts`.

## Magica

Tools call `POST /v1/nodes/{nodeType}/run` and poll `GET /v1/nodes/runs/{runId}` (`lib/tools/magica.ts`). Node types: `crop_image`, `gpt_image_2` (sub-models `gpt-image-2-text` / `gpt-image-2-edit`), `merge_videos`.

## Skills

Add a folder under `agent-skills/<name>/SKILL.md` with frontmatter:

```yaml
---
name: my-skill          # kebab-case, unique
description: When to use it
---
```

Files over 50KB, duplicate names and paths escaping the folder are rejected.
