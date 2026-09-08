# MyAvatar v2 — Product Requirements

**Status:** Phases 0-3 complete. Next: Phase 4 (audience join, speech-to-speech).
**Branch:** `version-2`
**Last updated:** 2026-09-07

---

## 1. Context

v1 is a working proof of concept: a CRA frontend posting to an Express `/chat` endpoint
that calls `gpt-4o-mini` in a hand-rolled tool-calling loop. All knowledge about Kaiwei is
committed to the repo as PDFs and text files and injected wholesale into the system prompt
on every request.

v2 has five goals:

1. Let MyAvatar handle the **Q&A section of a live presentation**, grounded in the slides.
2. Source knowledge from **public, real-time sources** — nothing personal stored in the repo.
3. **Modernise the stack** (CRA is deprecated and unpatched).
4. Keep hosting **free**.
5. Eventually support **speech-to-speech** for the Q&A section.

---

## 2. Guiding principles

- **No personal data in the repository, ever.** Not in git, not in git history.
- **No ingestion pipeline, no persistent store.** Context is fetched live and held in memory
  only. It dies with the process. This is a deliberate constraint, not an oversight.
- **Free hosting is a hard requirement.** Model API cost is separate, and must be capped.
- **Usage is infrequent** — roughly once every few months. Optimise for *correct and fresh
  on a cold start*, not for sustained throughput.
- **A bad answer in front of a live audience is the worst failure mode.** Prefer "let's take
  that offline" over a confident guess.

---

## 3. Non-goals

- Not building a general-purpose chatbot. Off-topic questions are explicitly refused.
- No vector database, no RAG index, no scheduled jobs, no persisted conversation storage.
- No talking-head avatar video (HeyGen / D-ID). Parked indefinitely.
- No SEO / marketing pages, so no Next.js. This stays an SPA.
- Not supporting audience-submitted questions in the initial release (see Phase 4).

---

## 4. Decisions log

Decisions already made, with reasoning, so they don't get relitigated.

| # | Decision | Reasoning |
|---|---|---|
| D1 | Q&A answers render **on-screen**, not spoken aloud, in the first release | Lower risk in a live room; no PA audio routing; voice deferred to Phase 4 |
| D2 | **Solo moderator by default** — Kaiwei types the questions himself | Removes audience UI, rooms, WebSockets, moderation queue, and the entire public prompt-injection surface. Audience join becomes an opt-in toggle later |
| D3 | Context fetched **once per session at warm-up**, not per question | Per-question fetching adds 5–10s to every answer, which is fatal in live Q&A. Nothing is persisted either way |
| D4 | **Vercel AI SDK v7** (v6 at time of decision; v7 shipped since), not the OpenAI Agents SDK | Provider-agnostic (one-line model swap), best-in-class React streaming, MCP support. Voice can drop down to OpenAI's realtime layer as an isolated module in Phase 4 |
| D5 | **Vite**, not Next.js | CRA is deprecated and unpatched; this is an SPA with no SEO needs |
| D6 | **pnpm workspace monorepo** | Phase 3 has three surfaces needing shared session/slide/question types. Cheap to do now on a small repo, expensive to retrofit mid-feature |
| D7 | **Stay on Render free tier** | Free is a hard requirement, usage is infrequent, and D2 removed the stateful-session argument for Cloudflare |
| D8 | **Slide decks parsed client-side** (pdf.js) | Render free tier is 512MB RAM / 0.1 CPU; parsing server-side is tight. Also keeps slides off the server entirely |
| D9 | **LinkedIn posts pasted manually at warm-up** | Real-time LinkedIn access is not achievable — see Blockers |
| D10 | Streaming deferred from Phase 0 to Phase 1 | AI SDK v6 implements it natively; no sense building it twice |

---

## 5. Known blockers

### LinkedIn real-time access is not possible

Confirmed 2026-09-07:

- Reading one's own posts requires the `r_member_social` permission, which is a **closed
  permission**. LinkedIn is not accepting access requests. This is a commercial decision,
  not a technical limit — there is no workaround.
- Third-party scrapers are gone. LinkedIn **sued Proxycurl in January 2025**; it shut down
  entirely by July 2025. Survivors are paid, ToS-grey, and legally exposed.
- Scraping from Render is the worst case — datacenter IPs are auth-walled fastest.

**Accepted workaround (D9):** a "recent activity" paste box on the prepare-session screen.
Text lives in session memory only. Two minutes of effort, used once every few months, 100%
reliable, free, and satisfies the no-storage constraint.

**Alternative if posting habits change:** cross-post to a personal site with an RSS feed,
which the avatar can then read live and fully automatically.

---

## 6. Phases

### Phase 0 — Foundation

Hardening and correctness on the existing codebase. Everything here survives the Phase 1
stack move.

- [x] **Untrack `server/data/` from git.** The repo is public; resume, LinkedIn export,
      salary expectation, notice period and family details are currently world-readable.
      Files stay on local disk so the app keeps running until Phase 2 removes the dependency.
- [x] **Decide on purging git history.** DECIDED 2026-09-07: not purging. Past commits keep the
      files and they stay readable on GitHub. Treat everything in the old `server/data/` —
      resume, salary expectation, notice period, family details — as permanently public.
- [x] **Hard spend cap on the OpenAI API key.** DONE 2026-09-07: $5/month project spend
      limit with alerts at 90% and 100%, confirmed hard ("requests will start to fail when
      limit is reached") rather than the notification-only org budget. Set on *Default
      project* — if that project is ever used for anything else, the avatar shares the
      budget with it and can be starved mid-presentation; move to a dedicated project if so.
      Model allow-list set to `gpt-4o-mini` only, so a leaked key cannot reach expensive
      models. See §9.
- [x] **Cache the system prompt.** `getSystemPrompt()` is currently called inside the request
      handler, re-parsing 11 certificate PDFs + LinkedIn + resume and hitting the GitHub API
      on *every message*.
- [x] **Authenticate the GitHub API call.** Capability added, but the variable is
      deliberately left UNSET. Measured 2026-09-07: 32 public repos fit in one page and
      the corpus is cached hourly, so the app makes 1 call/hour against a 60/hour limit.
      Caching this item's sibling fix is what actually solved the problem; the token was
      redundant on arrival. Revisit at Phase 2 (README fetching -> 33 calls/build) and
      note the unauthenticated limit is per source IP, so shared hosting shares the bucket.
- [x] **Wire up conversation history.** The server accepts `history` but the client never
      sends it, so every turn is amnesiac. Cap the window.
- [x] **Rate limit `/chat` per IP.** Currently unauthenticated and unthrottled.
- [x] **Relevance gate.** Cheap classifier in front of the expensive call: off-topic
      questions get a canned deflection and never reach the main model. Doubles as prompt-
      injection defence and cost control.
- [x] **Stop logging the full system prompt** to stdout on every request.
- [x] Fix the hardcoded resume filename (breaks on the next resume update).

### Phase 1 — Stack modernisation

- [x] pnpm workspace: `client/`, `server/`, `shared/`
- [x] CRA → Vite; TypeScript 4.9 → **7.0.2** (7.x is now `latest`; verified all three
      packages typecheck and the client builds on it)
- [x] Migrate the hand-rolled tool loop to the **AI SDK — v7, not v6** (v7 is current;
      `toUIMessageStreamResponse()` is deprecated in favour of top-level helpers, and the
      package is ESM-only, which forced the server to ESM)
- [x] **Response streaming** (deferred from Phase 0) — SSE via
      `pipeUIMessageStreamToResponse`, consumed by `useChat`. Wire format verified.
- [x] Drop `node-fetch` for native `fetch`
- [x] Eval suite: 35 golden Q&As across facts, grounding, boundary, injection, tools,
      persona and sensitive-observation categories (`server/evals/`). Mixed grading —
      deterministic assertions for facts and tool calls, an LLM judge for tone and
      groundedness. Run with `pnpm --filter server eval [-- --model <id>]`.
      Sensitive cases are observation-only and never fail the suite, since the content
      policy is deliberately deferred until after the POC.
- [ ] Evaluate model choice against the evals — `gpt-4o-mini` is weak for representing
      Kaiwei to recruiters; Claude Sonnet 5 is a candidate. ⏸️ BLOCKED on API credits.
      `CHAT_MODEL` / `GATE_MODEL` env vars already exist so the swap needs no code change
- [ ] ⚠️ Before the bake-off: add each candidate model to the OpenAI project **allow-list**,
      which is currently `gpt-4o-mini` only. Anything unlisted fails with a permission error
      that reads like a bug.

Also done, discovered mid-phase:

- [x] **Untrack `server/node_modules`.** 4,313 dependency files were committed to the repo,
      because the old `.gitignore` contained only `.env`.
- [x] Delete the dead hand-rolled tool loop (`utils/handleToolCall.ts`) and CRA scaffolding
      (`reportWebVitals`, `setupTests`, `App.test.tsx`, `react-app-env.d.ts`).
- [x] Document deployment in `docs/DEPLOYMENT.md`. ⚠️ **The live Render services need their
      settings updated before the next deploy** — the publish directory moved to
      `client/dist` and `REACT_APP_BE_URL` was renamed `VITE_BE_URL`.

### Phase 2 — Live context

- [x] ~~`sources.yaml`~~ — superseded: sources are **environment variables**, not a repo
      file, so even the URLs stay out of version control. `AVATAR_NAME`, `ABOUT_ME`,
      `RESUME_URL`, `SOURCE_URLS`.
- [x] Warm-up fetch into memory only (`server/sources.ts`). A bare GitHub profile URL
      expands to profile fields + public repos; Google Drive share links are rewritten to
      their direct-download form; published Google Docs are fetched as text; PDFs are
      parsed; anything else is reduced from HTML to text. Per-source timeout and size cap.
      A failing source is logged and skipped — a dead link must never break a live Q&A.
- [x] `web_search` tool via OpenAI's server-side search. **Off by default** (`ENABLE_WEB_SEARCH`)
      because it bills per call, but it is the avatar's only route to anything recent.
- [x] System-prompt intro stays, as `ABOUT_ME` — voice and framing only, no facts.
- [x] **`server/data/` deleted for real**, along with `dataLoaders.ts`. No personal content
      remains in the working tree. (Git history still has it — decided, see §6 Phase 0.)
- [x] Certificates corpus removed with it. It was contributing ~350 tokens of noise from
      image-based scans `pdf-parse` could not read.
- [x] Content policy is now enforced structurally rather than by prompt: the avatar knows
      exactly what Kaiwei chooses to publish and link. Salary, family and religion are out
      of scope unless he puts them back in. This is a better answer than the prompt rule
      the PRD originally imagined.
- [ ] "Recent activity" paste box for LinkedIn (D9) — no home until the Phase 3 prepare
      screen exists. Interim: paste recent posts into `ABOUT_ME`.
- [x] **Sources configured** 2026-09-07/08: `ABOUT_ME` (the old summary.txt, verbatim),
      `SOURCE_URLS` (GitHub profile), `RESUME_URL` (Google Drive). Suite back to 31/32 with
      facts 14/14.
- [x] Two silent-corruption bugs found while wiring the resume, both of which put garbage
      into the prompt while reporting success:
      1. A non-public Drive link returns **HTTP 200 with a sign-in page**, which was being
         ingested as if it were the resume. Now detected and rejected with instructions.
      2. PDF detection keyed off the content-type header and a `.pdf` suffix. Drive's
         direct-download URL has neither, so raw `%PDF-1.5 ... FlateDecode` bytes were fed
         to the model as text. Now sniffs the `%PDF-` magic bytes instead.
- [ ] ~~NEEDS KAIWEI: configure the sources~~ — done, see above. Original note: Measured 2026-09-07 immediately after
      deletion, with nothing configured: facts **0/14**, grounding **3/4**. Every failure
      was an honest "I don't have that information" — zero fabrication — but the avatar
      currently knows nothing. It stays that way until `ABOUT_ME` / `RESUME_URL` /
      `SOURCE_URLS` are filled in.
- [ ] Re-run the eval suite once sources are configured, to confirm recovery.
- [ ] Watch `ground-unknown-question-tool`: with an empty context the model stopped calling
      `record_unknown_question` — plausibly because not-knowing became the norm rather than
      the exception. Recheck once sources exist.

### Phase 3 — Presentation Q&A

- [x] **Prepare screen** at `/present`: load a deck, then run readiness checks.
- [x] **Client-side deck parsing** (decision D8). PPTX via JSZip, reading both
      `ppt/slides/slideN.xml` and the parallel `ppt/notesSlides/notesSlideN.xml`; PDF via
      pdf.js. Slides never reach the server. Verified against a synthetic PPTX fixture
      (`client/src/deck/_fixture.ts`) rather than needing PowerPoint installed — it covers
      numeric slide ordering (slide10 must not sort before slide2), the slide-number
      placeholder PowerPoint puts in the notes, and entity decoding.
- [x] **Speaker notes**, which is why PPTX is preferred and the UI says so. A PDF export
      discards them, and they are usually the richest signal — bullets are headlines, notes
      are what the presenter meant to say.
- [x] **`GET /ready`** — the pre-presentation checklist as one call. Wakes the service,
      rebuilds context, and spends a few tokens on a real model call, because that is the
      only way to prove the key works and has credit. Every failure it reports has already
      happened silently in this project: expired credits, a non-public Drive link, unset
      SMTP.
- [x] **`POST /present`** with the Q&A persona. Short answers, deck first and background
      second, slide citations, and a graceful decline. **No relevance gate**, deliberately:
      the gate exists to stop the public web treating the avatar as a free LLM, but the
      presenter is the only person typing (D2), and the gate would block questions about the
      talk's own subject — "explain how Kubernetes works" is abuse on the website and a fair
      audience question if the talk is about Kubernetes.
- [x] Presenter panel styled for a projector: large answer type, quiet chrome.
- [x] Route split so the deck parsers load only when presenting — the main bundle is
      unchanged at 361KB, with the presentation code in a 101KB chunk and pdf.js in a
      further 431KB chunk loaded only when a PDF is opened.
- [ ] Try passing rendered slide images to a vision model — charts and diagrams carry
      meaning that text extraction loses.
- [ ] Optional cron pinger on talk days, as backup to the prepare screen's wake-up.

### Phase 4 — Later

- [ ] Audience join toggle: QR code, join page, moderation queue, WebSocket fan-out
- [x] **Voice input and output on both screens**, using the browser's own speech APIs.
      Chosen over the OpenAI audio endpoints for the first cut because it is free, adds no
      server round-trip and needs no key handling — all of it is contained in
      `client/src/voice/useVoice.ts`, so swapping in the paid endpoints later is a
      one-file change. Support in 2026 is Chrome, Edge and Safari, all still behind the
      `webkitSpeechRecognition` prefix; Firefox keeps it behind a flag, so the buttons hide
      rather than break. Both APIs require HTTPS or localhost.
      - Dictation **fills the box rather than sending**: a misheard question would
        otherwise be answered on a projector in front of a room.
      - Spoken answers are **off by default** and remembered per browser, and speak once on
        completion rather than per streamed chunk. Decision D1 kept answers on screen, so
        the presenter opts in.
- [ ] Upgrade voice quality if the OS voices disappoint: `gpt-4o-transcribe` at $0.006/min
      is more accurate in a noisy room, and `gpt-4o-mini-tts` at $0.015/min sounds far
      better than browser synthesis — about $0.02 for a 20-minute Q&A.
- [ ] ⚠️ Add `gpt-realtime-mini` to the OpenAI project allow-list before full realtime work
- [ ] Full speech-to-speech via OpenAI Realtime over WebRTC with ephemeral tokens
      (browser talks to OpenAI directly; the server only mints 60-second tokens and never
      proxies audio)
- [ ] Optional voice clone so it sounds like Kaiwei — with an explicit "this is an AI"
      disclosure to the room

---

## 7. Cross-cutting requirements

- **Analytics on what people ask.** Quietly the most valuable output of the project — a log
  of what recruiters and audiences actually want to know. Currently invisible.
- **Cost controls:** hard spend cap, per-IP rate limit, per-session message cap, max input
  length, relevance gate.
- **Secrets hygiene:** mark all env vars sensitive, scheduled rotation. Note that any PaaS
  that injects env vars can read them — the April 2026 Vercel/Context.ai breach demonstrated
  this, and Render shares the same trust model. The spend cap is the real control.
- **Contact capture** beyond Pushover-only — email or webhook, stored somewhere queryable.
  ⚠️ Audited 2026-09-07: `PUSHOVER_TOKEN`/`PUSHOVER_USER` are **unset**, so contact capture
  is currently a no-op. The tools still report success and the avatar still tells the
  visitor it has passed the message on, but nothing is sent and nothing is stored. Anyone
  who has left an email has vanished. A second, persistent channel would make this
  failure mode impossible rather than merely fixed.
- **Multilingual** — Mandarin support is close to free with modern models and relevant to a
  Singapore audience.

---

## 8. Model choice and cost

Corpus measured 2026-09-07: **~3,600 tokens total** (summary 790, resume 1,777, certificates
346, github 468, linkedin 213). System prompt lands around 4,000 tokens.

That makes cost a non-factor at this usage. Per question is roughly 6,000 input + 300 output
tokens, so a 30-question session costs about:

| Model | Input $/1M | Output $/1M | ~Cost / 30-question session |
|---|---|---|---|
| `gpt-4o-mini` (current) | — | — | a few cents |
| `claude-sonnet-5` | $2 | $10 | ~$0.45 |
| `claude-opus-5` | $5 | $25 | ~$1.15 |

At a handful of sessions a year that is under $5/year on any of them. **Quality should win
outright** — `gpt-4o-mini` is the cheapest possible model and it is the thing representing
Kaiwei to recruiters.

Decisions:

- **Two models, not one.** The relevance gate stays cheap and fast (it runs on every message
  and emits one token). The answering brain should be strong. Do not collapse these.
- **Do not switch now.** D4 exists precisely so this is a one-line, evidence-based swap in
  Phase 1 against the eval suite. Switching by hand before the AI SDK lands is rework.
- **Enable prompt caching** whichever provider wins. The system prompt is byte-identical
  across turns in a session, which is the ideal case, and cached reads are ~10% of input
  cost. Note ~4,000 tokens is near the minimum cacheable prefix — verify with
  `cache_read_input_tokens` rather than assuming it caches.

## 9. Spend caps

**OpenAI.** The org-level "monthly budget" is a *notification only* — requests keep going
through after it trips. The hard stop is a **project-level** spend limit, which returns 429
once tracked spend hits the ceiling. So: put MyAvatar in its own project, issue a key scoped
to that project, and cap the project. A leaked key can then only ever spend that project's
budget.

Current state: $5/month hard limit on the OpenAI *Default project*, alerts at 90% and 100%.
Model allow-list is set to `gpt-4o-mini` only. One open refinement — move the avatar to a
dedicated project if Default is shared with other work.

The allow-list is a live dependency, not a set-and-forget: Phase 1's model bake-off and
Phase 4's voice work both need models added to it first, or they fail with a permission
error that looks like a code bug.

**Anthropic**, if the brain moves to Claude: Console → Settings → Limits carries an
organization spend limit plus per-workspace limits (a workspace limit may be lower than the
org limit, not higher). Same pattern — a dedicated workspace with its own cap and key.
Note that the OpenAI cap does **not** cover Anthropic spend, and the relevance gate is
expected to stay on OpenAI — so after a Phase 1 model swap both providers need capping.

## 10. Credits and running cost

Confirmed 2026-09-07, both providers:

| | Promotional credits | Purchased credits |
|---|---|---|
| OpenAI | ~3 months | 1 year from purchase, non-refundable, cannot be extended |
| Anthropic | As stated at issue | 1 year from purchase, non-refundable |

**Kaiwei's original promotional credits expired unused**, which took the deployed avatar
offline silently — every call fails at a zero balance, and nothing notifies you.

Consequences for a few-times-a-year usage pattern:

- **Top up small and just-in-time.** $5 is ~150 sessions on `gpt-4o-mini` or ~10 on
  Sonnet-class. Buying more than the minimum just donates the remainder back at expiry.
- **Real running cost is roughly $5/year, mostly unused** — effectively a small annual
  subscription, not a one-off purchase.
- **Balance is the real hard cap.** Auto-recharge is off (the balance reached zero and
  stayed there), so the prepaid balance bounds spend more tightly than the $5 project limit.
  Keep the project limit anyway, in case auto-recharge is ever enabled.
- **Do not hold balances with two providers.** Run the Phase 1 bake-off on a small OpenAI
  top-up, pick a winner, then keep exactly one balance alive.

## 11. Eval reliability

Model temperature is pinned to 0, but OpenAI is not fully deterministic even so, and the
LLM-judged cases inherit that. `ground-unknown-employer` has flipped between runs twice
without any related code change.

Reading scores accordingly:

- **Deterministic assertions** (`mustMention`, `mustNotMention`, `mustCallTool`,
  `mustCaptureUnknown`) are stable and are what the safety-critical properties rest on.
  `ground-unknown-employer` also carries a hard "must not claim to have worked at Google"
  assertion, which has never failed — only the judge's stylistic verdict wobbles.
- **Judged cases** carry roughly ±1 of noise per run.

So a one-point difference between two models means nothing. Before acting on a bake-off
result, re-run, or treat differences smaller than about 2 points as noise.

## 12. Open questions

- Purge git history of `server/data/`, or accept the past exposure? (needs force push)
- Off-limits content policy — deferred until after the POC
- Model choice for the text brain — decide against the Phase 1 eval suite
