# Deployment

> ⚠️ **Phase 1 changed the repo layout and the frontend env var name. The existing
> Render services will not work until their settings are updated.** Details below.

The repo is a pnpm workspace with three packages: `client`, `server`, `shared`.

---

## What changed in Phase 1

| | Before (v1) | After (v2) |
|---|---|---|
| Layout | Two independent npm projects | pnpm workspace, `shared` package between them |
| Package manager | npm | **pnpm** (`packageManager` is pinned in the root `package.json`) |
| Frontend build | `react-scripts build` (CRA) | `vite build` |
| Frontend output | `client/build` | **`client/dist`** |
| Frontend env var | `REACT_APP_BE_URL` | **`VITE_BE_URL`** |
| Server entry | `ts-node-dev index.ts` | `tsx index.ts` |
| Server modules | CommonJS | **ESM** (`ai` v7 is ESM-only) |
| Chat response | One blocking JSON blob | **Streamed** (SSE, AI SDK UI message stream) |

The two that will silently break a deploy: the **publish directory** and the
**env var rename**. A frontend built without `VITE_BE_URL` set will compile
fine and then fail on every request at runtime.

---

## Server (Render Web Service)

| Setting | Value |
|---|---|
| Root directory | *(repo root — not `server/`)* |
| Build command | `corepack enable && pnpm install --frozen-lockfile` |
| Start command | `pnpm --filter server start` |
| Node version | 20 or later |

Environment variables — see `server/.env.example` for the full list. Mark every
one **sensitive** in the Render dashboard. At minimum:

- `OPENAI_API_KEY` (required)
- `AVATAR_NAME`, `ABOUT_ME`, `RESUME_URL`, `SOURCE_URLS` — everything the avatar knows.
  With none of these set it will honestly answer "I don't have that information" to
  every factual question.
- `PUSHOVER_TOKEN` / `PUSHOVER_USER` — without them contact capture is a silent no-op.

> **Context is cached in memory for an hour.** Changing any source variable, or changing
> what a linked URL contains, has no effect on a running instance until the TTL lapses or
> the service restarts. After changing them, restart the service rather than assuming the
> change took.

Render sets `PORT` itself; do not override it.

### Cold starts

The free tier spins down after **15 minutes** idle and takes **30–60 seconds** to
wake. Because the avatar is used only a few times a year, it will *always* be
cold on arrival. `GET /health` is the wake-up endpoint — hit it a few minutes
before a presentation. See the Phase 3 pre-presentation checklist in the PRD.

---

## Client (Render Static Site, or any static host)

| Setting | Value |
|---|---|
| Root directory | *(repo root)* |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter client build` |
| Publish directory | `client/dist` |

Environment variables:

- `VITE_BE_URL` — the deployed server's base URL, with no trailing slash
  (e.g. `https://myavatar-api.onrender.com`)

Vite inlines `VITE_*` variables **at build time**, not at runtime. Changing this
value requires a rebuild, not just a restart.

---

## Local development

```bash
corepack enable          # once, to get pnpm
pnpm install             # installs all three packages
cp server/.env.example server/.env        # then fill in OPENAI_API_KEY
cp client/.env.example client/.env.local

pnpm dev                 # runs client (:3000) and server (:3001) together
```

Individually: `pnpm dev:server`, `pnpm dev:client`.

Other scripts: `pnpm typecheck` (all packages), `pnpm build` (client production
build).

There is no server build step — it runs from TypeScript source via `tsx` in both
development and production. At this scale a compile step buys nothing.
