# Deployment

> ⚠️ **v2 changed the repo layout, the build output directory and the frontend
> env var name. The existing Render services will not work until their settings
> are updated.** The whole point of `render.yaml` is that this never happens
> again silently.

The repo is a pnpm workspace with three packages: `client`, `server`, `shared`.

---

## 0. First: find out what you currently have

The dashboard is the only record of the v1 setup, so check before changing anything.
At [dashboard.render.com](https://dashboard.render.com), note for each service:

| What to look at | Why it matters |
|---|---|
| How many services, and their **types** (Web Service / Static Site) | Tells you whether the frontend is on Render at all |
| Each service's **Branch** | Render only deploys the branch named here. v2 lives on `version-2`, which has not been pushed |
| Static site's **Publish directory** | If it says `client/build`, that is now wrong — see below |
| Web service's **Build** and **Start** commands | v1 used npm and `ts-node-dev`; both changed |
| **Environment** tab on each | `REACT_APP_BE_URL` is now `VITE_BE_URL`, and the server needs several new variables |

---

## What changed in v2

| | v1 | v2 |
|---|---|---|
| Layout | Two independent npm projects | pnpm workspace + `shared` package |
| Package manager | npm | **pnpm** (pinned in the root `package.json`) |
| Frontend build | `react-scripts build` (CRA) | `vite build` |
| Frontend output | `client/build` | **`client/dist`** |
| Frontend env var | `REACT_APP_BE_URL` | **`VITE_BE_URL`** |
| Server entry | `ts-node-dev index.ts` | `tsx index.ts` |
| Server modules | CommonJS | ESM (`ai` v7 is ESM-only) |
| Chat response | One blocking JSON blob | Streamed (SSE) |
| Avatar knowledge | PDFs committed to the repo | Live fetch from `RESUME_URL` / `SOURCE_URLS` |
| Notifications | Pushover | SMTP email |

The two that break a deploy **silently**: the publish directory, and the env var
rename. A frontend built without `VITE_BE_URL` compiles fine and then fails on
every request, because Vite inlines `VITE_*` at build time.

---

## 1. Deploy with the Blueprint (recommended)

Existing services, confirmed 2026-09-08:

| Service | Type | Region | Notes |
|---|---|---|---|
| `MyAvatar-BE` | Web Service (Node) | Singapore | Deployed recently |
| `MyAvatar-FE-1` | Static Site | Global | Live ~1 year, still the CRA build |

[`render.yaml`](../render.yaml) uses **these exact names**, which matters: Render
adopts an existing resource when the name in the Blueprint matches, and creates a
second one when it does not. Matching the names is what preserves the FE's
year-old URL.

**Before applying, cross-check the dashboard against `render.yaml`.** Render's
own warning: include every option currently set on the resource, or Blueprint
defaults overwrite it. In particular confirm:

- `plan` — the file says `free` on the API. If yours is on a paid plan, change it
  or the Blueprint downgrades the service.
- `region: singapore` on the API. Region cannot be changed after creation, so a
  mismatch means Render will not adopt the service.
- `branch` — both say `develop`. v2 lives on `version-2`, which has not been
  pushed. Either merge to `develop`, or change both `branch:` values.
- Any settings you have that the file does not mention (custom domains, headers,
  auto-deploy) — add them before applying.

Then: **New > Blueprint**, pick this repo, and fill in each `sync: false`
variable when prompted. See `server/.env.example` for what each does. Set the
FE's `VITE_BE_URL` to the BE's URL, with no trailing slash.

## 2. Settings, if configuring by hand

### `MyAvatar-BE` — Web Service

| Setting | Value |
|---|---|
| Root directory | *(repo root — not `server/`)* |
| Build command | `corepack enable && pnpm install --frozen-lockfile` |
| Start command | `pnpm --filter server start` |
| Health check path | `/health` |
| `NODE_VERSION` | `22` |

There is no server build step; it runs from TypeScript source via `tsx`. At this
scale a compile stage buys nothing.

Environment variables — full descriptions in `server/.env.example`. Mark every
one **sensitive**:

- `OPENAI_API_KEY` — required
- `AVATAR_NAME`, `ABOUT_ME`, `RESUME_URL`, `SOURCE_URLS` — everything the avatar
  knows. With none set it honestly answers "I don't have that information" to
  every factual question
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — without these, contact
  capture is dropped and logged

`ABOUT_ME` is multi-line. Render's dashboard handles that fine; the surrounding
double quotes are only needed in a `.env` file.

Do **not** set `PORT` — Render assigns it, and a hardcoded value fails the
health check.

### `MyAvatar-FE-1` — Static Site

This one has not rebuilt in about a year, so it is still serving the CRA bundle
and still expects `REACT_APP_BE_URL`. Every value below changes.

| Setting | Value |
|---|---|
| Root directory | *(repo root)* |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter client build` |
| Publish directory | **`client/dist`** |
| Rewrite rule | Source `/*` → Destination `/index.html`, action **Rewrite** |
| `VITE_BE_URL` | The API service's URL, no trailing slash |
| `NODE_VERSION` | `22` |

---

## 3. After deploying

- **Context is cached in memory for an hour.** Changing a source variable, or
  changing what a linked URL contains, does nothing to a running instance until
  the TTL lapses or the service restarts. Restart rather than assume.
- Check the API logs on boot. It reports which sources loaded and whether SMTP
  verified, so a bad `RESUME_URL` or app password shows up immediately rather
  than the first time a visitor hits it.

### Cold starts

The free tier spins down after **15 minutes** idle and takes **30–60 seconds** to
wake. Because the avatar is used a few times a year, it is *always* cold on
arrival. `GET /health` is the wake-up endpoint — hit it a few minutes before a
presentation. See the Phase 3 pre-presentation checklist in the PRD.

---

## Local development

```bash
corepack enable          # once, to get pnpm
pnpm install             # installs all three packages
cp server/.env.example server/.env        # then fill in OPENAI_API_KEY
cp client/.env.example client/.env.local

pnpm dev                 # client (:3000) and server (:3001) together
```

Individually: `pnpm dev:server`, `pnpm dev:client`. Other scripts:
`pnpm typecheck` (all packages), `pnpm build` (client production build),
`pnpm --filter server eval` (the eval suite — costs real money to run).

Verified from a clean clone with an empty pnpm store, which is what Render does:
`pnpm install --frozen-lockfile`, `pnpm --filter client build` and
`pnpm --filter server start` all succeed, and the lockfile carries the Linux
platform binaries Render needs.
