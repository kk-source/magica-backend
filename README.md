# magica-backend

API and agent runtime for a Galaxy-style agent chat. Users chat with an LLM agent that can load skills and call real Magica media tools (crop an image, generate/edit images with GPT Image 2, merge videos). Long-running agent work runs on Trigger.dev, and progress streams to the browser through Trigger.dev Realtime.

The UI lives in a separate repo: [magica-frontend](https://github.com/kk-source/magica-frontend).

## Stack

| Concern | Choice |
|---|---|
| HTTP API | Next.js 15 App Router (API routes only), TypeScript strict |
| Validation | Zod 4 on every request body, query and env var |
| Database | PostgreSQL + Prisma 7 (`@prisma/adapter-pg`) |
| Auth | Clerk (Bearer session token from the frontend) |
| Background jobs | Trigger.dev v4 (`agent-run` task) + Realtime run metadata |
| LLM | OpenRouter (free tier) via the `openai` SDK, tool calling |
| Media tools | Magica inference API (`crop_image`, `gpt_image_2`, `merge_videos`) |
| Uploads | Transloadit (server signs Assembly params, browser uploads directly) |

## Architecture

```
 Browser (magica-frontend)
   │  Clerk Bearer token
   ▼
 Next.js API routes ──► Postgres (Prisma)
   │ tasks.trigger("agent-run")         ▲
   ▼                                    │ persist reply, tool calls, credits
 Trigger.dev worker: agent-run ─────────┘
   │  OpenRouter tool-calling loop (max 10 steps)
   ├─► load_skill / read_skill_asset  (agent-skills/ on disk)
   └─► Magica API: POST /nodes/{type}/run, poll /nodes/runs/{id}
   │
   └─ metadata.set(text, toolSteps) ──► Trigger.dev Realtime ──► Browser
```

### Request flow

1. `POST /api/chats/:id/messages` `{ content, attachments?, idempotencyKey? }` checks credits, stores the user message and an `AgentRun` in one transaction, triggers the `agent-run` task, and returns `{ message, runId }`. Retries with the same idempotency key return the same run instead of starting a second one.
2. `agent-run` loads the chat history, runs the OpenRouter tool-calling loop (`lib/agent/loop.ts`) and writes partial text plus tool steps into the Trigger.dev run metadata as it goes.
3. `GET /api/chats/:id/runs/:runId` returns the run status and, while it is active, a short-lived Realtime token `{ runId, accessToken }`. The frontend subscribes to the run directly, with a slow safety poll as a fallback.
4. On finish the task saves the assistant message (text, tool steps, media, credit cost, suggested follow-ups), records each `ToolInvocation`, and debits the user's credits in a `CreditLedger` entry. Failures and cancels mark the run `FAILED` / `CANCELLED`.

### API

All routes require a Clerk session token (`Authorization: Bearer …`) and return JSON. CORS allows only `FRONTEND_ORIGIN`.

| Method | Route | Purpose |
|---|---|---|
| GET / POST | `/api/chats` | List chats / create a chat |
| GET / DELETE | `/api/chats/:chatId` | Chat with messages / delete chat |
| GET / POST | `/api/chats/:chatId/messages` | List messages / send a message and start a run |
| GET | `/api/chats/:chatId/runs/:runId` | Run status, live text, tool steps, Realtime token |
| POST | `/api/chats/:chatId/runs/:runId/cancel` | Cancel a running agent |
| GET | `/api/me` | Current user and credit balance |
| POST | `/api/uploads/params` | Signed Transloadit Assembly params |

Request and response shapes live in `lib/contracts.ts`. The frontend mirrors them in `lib/api/schemas.ts`, so change both together.

### Code layout

| Path | What |
|---|---|
| `app/api/**` | Route handlers, wrapped by `handler()` in `lib/http.ts` so errors become JSON |
| `middleware.ts` | Clerk auth + CORS for `/api/*` |
| `lib/contracts.ts` | Zod schemas for the API contract |
| `lib/env.ts` | Zod-validated env, parsed lazily so `next build` needs no secrets |
| `lib/agent/loop.ts` | OpenRouter tool-calling loop, yields text and tool events |
| `lib/agent/steps.ts` | Turns tool events into UI steps, credits and follow-up suggestions |
| `lib/tools/` | Tools: `crop_image`, `gpt_image_2`, `merge_videos`, `load_skill`, `read_skill_asset` |
| `lib/tools/magica.ts` | Magica client: start a node run, poll until done, abort on cancel |
| `lib/skills/registry.ts` | Scans `agent-skills/*/SKILL.md` frontmatter at startup |
| `trigger/agent-run.ts` | The Trigger.dev task |
| `prisma/schema.prisma` | Data model: User, Chat, Message, AgentRun, Attachment, ToolInvocation, RunSkill, Waitpoint, CreditLedger |

## Tools and skills

**Magica tools** call `POST {MAGICA_API_BASE_URL}/nodes/{nodeType}/run` and poll `GET /nodes/runs/{runId}` until `COMPLETED` or `FAILED`.

- `crop_image`: `image_url` plus x/y/width/height in percent or pixels (aspect-ratio crops are computed from the real image size).
- `gpt_image_2`: text-to-image (`gpt-image-2-text`), or edit (`gpt-image-2-edit`) when input images are given.
- `merge_videos`: 2 to 100 `video_urls`, transition `none | fade | dissolve`.

**Skills** live in `agent-skills/<name>/SKILL.md`. Only the name and description go into the system prompt; the agent pulls the full body with `load_skill` and extra files with `read_skill_asset`. Shipped skills: `image-generation`, `image-editing`, `video-merge`. To add one:

```yaml
---
name: my-skill          # kebab-case, unique
description: When the agent should use it
---
Instructions for the agent…
```

Files over 50KB, duplicate names and paths that escape the skill folder are rejected.

## Local setup

Requirements: Node 20+, pnpm 10, a Postgres database, and accounts for Clerk, Trigger.dev, OpenRouter, Magica and Transloadit.

```bash
pnpm install
cp .env.example .env        # fill in the keys below
pnpm db:migrate             # prisma migrate dev
pnpm dev                    # API on http://localhost:4000
pnpm trigger:dev            # second terminal: runs the agent task locally
```

Then start the frontend on http://localhost:3000 with `NEXT_PUBLIC_BACKEND_URL=http://localhost:4000`.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Same Clerk app as the frontend |
| `CLERK_SECRET_KEY` | yes | Same Clerk app as the frontend |
| `FRONTEND_ORIGIN` | yes | Frontend URL, used for CORS (no trailing slash) |
| `TRIGGER_SECRET_KEY` | yes | `tr_dev_…` locally, `tr_prod_…` on Vercel |
| `TRIGGER_PROJECT_REF` | yes | `proj_…` from the Trigger.dev dashboard (`TRIGGER_PROJECT_ID` also accepted) |
| `OPENROUTER_API_KEY` | yes | OpenRouter key |
| `OPENROUTER_MODEL` | no | Defaults to `openrouter/auto`; set a free, tool-calling model to stay on the free tier |
| `MAGICA_API_KEY` | yes | Magica key (`gx_…`) |
| `MAGICA_API_BASE_URL` | no | Defaults to `https://inference.magica.com/v1` |
| `TRANSLOADIT_KEY` / `TRANSLOADIT_SECRET` | for uploads | Without them `/api/uploads/params` returns 503 and the rest still works |
| `TRANSLOADIT_TEMPLATE_ID` | no | Without it uploads use an inline `/upload/handle` step (files kept ~24h on Transloadit temp storage) |

## Deploy

The backend deploys in two parts: the API on Vercel and the agent worker on Trigger.dev.

### 1. Database

Create a hosted Postgres (Neon, Supabase, Railway…) and apply migrations:

```bash
DATABASE_URL=<prod url> pnpm prisma migrate deploy
```

### 2. Trigger.dev worker

```bash
pnpm trigger:deploy         # prisma generate && trigger.dev deploy
```

`trigger.config.ts` bundles `agent-skills/**` into the worker via `additionalFiles`, so skills work in production. In the Trigger.dev dashboard, under **Environment variables → Production**, add `DATABASE_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `MAGICA_API_KEY` and `MAGICA_API_BASE_URL`. The worker does not read Vercel's env, and it crashes on its first query without them.

Redeploy the worker whenever `trigger/`, `lib/agent`, `lib/tools`, `lib/skills` or `agent-skills/` change. A Vercel deploy alone does not update it.

### 3. Vercel API

Import the repo into Vercel (framework: Next.js; build command `pnpm build` runs `prisma generate`). Set every variable from the table above, with `TRIGGER_SECRET_KEY` as the **production** key and `FRONTEND_ORIGIN` as the frontend's Vercel URL. Pushes to `main` deploy automatically.

### Checklist after deploy

- `GET /api/chats` without a token returns 401 JSON (auth and CORS are wired).
- Sending a message returns 202 and the run appears in the Trigger.dev dashboard.
- "Generate an image of a sunset" loads the `image-generation` skill and returns an inline image.

## Design decisions and trade-offs

- **Separate API and worker.** Agent runs can take minutes (image generation is 30 to 90s per call), which exceeds serverless request limits. Trigger.dev gives durable execution, cancel, retries and a 15-minute budget, and the API stays fast. The cost is a second deploy target and a second set of env vars.
- **Realtime over SSE from the API.** The worker writes progress to run metadata and the browser subscribes with a scoped, short-lived token. Vercel functions never hold open streams. A 5s poll covers dropped connections.
- **Postgres is the source of truth.** Realtime only carries live progress; the final message, tool calls and credits are written to the database, so a refresh always shows the right state.
- **Idempotent sends.** The idempotency key is unique on `AgentRun` and is also passed to Trigger.dev, so double clicks and retries never start two runs.
- **Credits debited after the run** from Magica's reported `creditUsed`, in the same transaction as a ledger row. Simple and auditable; a user could overdraw by one run, which is acceptable here.
- **Lazy skills.** Only skill names and descriptions go into the prompt, keeping context small on free models. Bodies load on demand.
- **Free LLM tier.** Cheap but slower and less reliable at tool calling. The loop is capped at 10 steps and tool errors are returned to the model so it can recover.
- **Shared contract by convention.** Two repos mean no shared package, so `lib/contracts.ts` and the frontend's `lib/api/schemas.ts` are kept in sync by hand. Zod on both ends makes drift fail loudly.
- **Uploads go straight to Transloadit.** Files never pass through Vercel (body size limits); the API only signs Assembly params so clients cannot run arbitrary robots on the account.
- **Out of scope for the timeline:** automated tests, docs site, webhooks and an MCP server.
