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

Live services, confirmed 2026-09-08:

| Service | Type | Region | Hostname |
|---|---|---|---|
| `MyAvatar-BE` | Web Service (Node) | Singapore | **`myavatar-fe.onrender.com`** |
| `MyAvatar-FE-1` | Static Site | Global | **`myavatar-fe-1.onrender.com`** |

> ⚠️ **The hostnames are misleading.** The *backend* answers on
> `myavatar-fe.onrender.com` — no "be" anywhere in it — because Render derived
> that hostname from the repository name (`MyAvatar-FE`) when the service was
> first created, and renaming the service to `MyAvatar-BE` afterwards did not
> change it. The frontend is the one with the `-1` suffix.
>
> So `VITE_BE_URL` on the static site is `https://myavatar-fe.onrender.com`,
> which looks wrong and is right. Check `/health` before assuming a URL is
> stale: the backend returns `{"ok":true,"uptime":...}`, while an unknown
> Render subdomain returns a plain-text `Not Found` that is indistinguishable
> from Express's own 404.

[`render.yaml`](../render.yaml) uses **these exact names**, which matters: Render
adopts an existing resource when the name in the Blueprint matches, and creates a
second one when it does not. Matching the names is what preserves the FE's
year-old URL.

**Before applying, cross-check the dashboard against `render.yaml`.** Render's
own warning: include every option currently set on the resource, or Blueprint
defaults overwrite it. In particular confirm:

Confirmed 2026-09-08: both services are on the **free** plan and neither has a
custom domain, so nothing in the dashboard is at risk of being reset.

- `plan: free` on the API — matches. Static sites have no plan field.
- `region: singapore` on the API — region cannot be changed after creation, so a
  mismatch means Render forks a second service instead of adopting this one.
- `branch: version-2` on both. Deploying v2 on its own branch first leaves
  `develop` as a working fallback: reverting is a branch change rather than a
  git revert. Switch both to `develop` once v2 is merged.

Then: **New > Blueprint**, pick this repo, and fill in each `sync: false`
variable when prompted. See `server/.env.example` for what each does.

Values to have ready — copy from your local `server/.env`:

| Variable | Notes |
|---|---|
| `OPENAI_API_KEY` | |
| `AVATAR_NAME` | |
| `ABOUT_ME` | ~3,000 characters, multi-line. Paste **without** the surrounding double quotes — those are a `.env` file requirement, not a value |
| `RESUME_URL` | The Drive share link. Must stay shared as "Anyone with the link" |
| `SOURCE_URLS` | |
| `SMTP_HOST` / `SMTP_PORT` | `smtp.gmail.com` / `587` |
| `SMTP_USER` / `SMTP_PASS` | Gmail address and the 16-character App Password |
| `VITE_BE_URL` | **On the static site**, set to the BE's URL with no trailing slash |
| `VITE_SPEECH_FIXES` | **On the static site.** Respellings for words the browser mispronounces, e.g. `Ada=Ay-duh`. No code default — unset means the mispronunciations come back |
| `VITE_SPEECH_VOICE` | Optional. Defaults to `Microsoft Mark`. Only a preference: the voice has to exist on the *visitor's* machine |

`VITE_BE_URL` is inlined at build time, so if you set it after the first build,
trigger a rebuild — a restart will not pick it up.

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

## 3. Verifying a deploy

From the outside, without opening the browser:

```bash
BE=https://myavatar-fe.onrender.com

# Liveness, and the wake-up call before a presentation.
curl "$BE/health"                 # {"ok":true,"uptime":...}

# A real answer, streamed.
curl -N -X POST "$BE/chat" -H 'Content-Type: application/json'   -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Where did you go to university?"}]}]}'
```

To confirm the frontend picked up `VITE_BE_URL`, check what got baked into the
bundle — Vite inlines it at build time, so this is the only way to be sure a
rebuild actually took:

```bash
FE=https://myavatar-fe-1.onrender.com
ASSET=$(curl -s "$FE/" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)
curl -s "$FE$ASSET" | grep -oE 'https://[a-z0-9-]+\.onrender\.com' | sort -u
```

Verified working in production on 2026-09-08: NUS/Information Systems from
`ABOUT_ME`, PMP and Machine Learning from the resume via `RESUME_URL`, and an
off-topic coding request correctly refused by the relevance gate.

## 4. After deploying

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
