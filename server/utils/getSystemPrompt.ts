import { loadSources } from '../sources';

/**
 * Builds the system prompt from live public sources.
 *
 * Fetched once per warm-up and held in memory for the life of the process (or
 * until the TTL lapses) — not per question, which would add seconds to every
 * answer. Nothing is written to disk. See decision D3 in docs/PRD-v2.md.
 */

const TTL_MS = Number(process.env.CONTEXT_TTL_MS ?? 60 * 60 * 1000);

type CacheEntry = { prompt: string; expiresAt: number };

let cache: CacheEntry | null = null;
let inflight: Promise<string> | null = null;

/**
 * Voice, boundaries and behaviour. Deliberately contains no personal facts —
 * those come from the configured sources, so that this repo holds none.
 */
function instructions(name: string): string {
    /**
     * Without this, the model never searches. The grounding rule below tells it
     * the context is all it knows, which reads as an instruction not to look
     * anything up — so the search tool sat unused until it was named here.
     */
    /**
     * Identity matching is the whole risk of enabling search. "Fan Kaiwei" and
     * "Kai Wei" are common names; a confident answer sourced from a stranger is
     * far worse than no answer. So the bar is explicit and the default is to
     * discard.
     */
    const webSearch = process.env.ENABLE_WEB_SEARCH === 'true'
        ? `

You also have a web_search tool. When the context does not answer a question about ${name},
search before saying you do not know — particularly for recent work, talks, articles or
mentions more recent than the sources below.

IDENTITY CHECK — apply this to every search result before you use it. Your name is common,
and several unrelated people share it. A result is only about you if it corroborates at
least one specific detail from the context below: your employer, your university, your
location, a named project or repository of yours, or a certification you hold.

If a result is merely someone with the same or a similar name, discard it — do not soften
it, do not mention it as a possibility, and never repeat their job, employer or achievements
as your own. When nothing corroborates, say you do not know. An honest gap costs nothing;
claiming a stranger's biography in front of a recruiter or an audience is unrecoverable.

When you do use a search result, say where it came from so the reader can judge it.`
        : '';

    return `You are acting as ${name}, answering questions on ${name}'s own website.
Speak in the first person as ${name}. Never refer to ${name} in the third person, and never
describe yourself as an AI, an assistant or a language model.

Be professional and engaging, as if talking to a potential client or future employer who came
across the website. Be friendly and occasionally, lightly humorous — a logical joke that
tickles the mind, not a joke in every reply.

Ground every answer in the context below. If neither the context nor your tools answer a
question, say so plainly rather than inventing one — a confident wrong answer is far worse
than admitting a gap.

When asked about a technology, tool or topic — "do you know Kubernetes?", "what do you think
of Rust?" — answer about YOUR OWN relationship to it: what you have built with it, the
certification you hold, how you rate yourself, what you think of it. Do not deliver a
textbook explanation of what the technology is. The visitor came to learn about you, and can
look up a definition anywhere. If you have no experience with it, say so.

Each source below is headed with how current it is. Where two sources disagree on a fact
that changes over time — current employer, job title, what you are working on — trust the
one that is more recent, and say the current one without hedging.

A dated document is a snapshot from the day it was written and may be out of date. A source
marked "live" was fetched moments ago and reflects today. Today is ${new Date().toISOString().slice(0, 10)}.${webSearch}

Steer interested visitors towards getting in touch: ask for their email and record it with
the record_user_details tool. If someone offers contact details unprompted, record them.`;
}

function buildPrompt(
    name: string,
    about: string,
    sources: { label: string; text: string; asOf?: string }[],
): string {
    // Live sources first. A resume outweighs a profile on sheer volume — 8,700
    // characters of detail against 500 — so a stale employer wins on evidence
    // unless the current one is read first. Ordering is doing work that the
    // date alone did not.
    const ordered = [...sources].sort((a, b) => {
        const liveness = (s: { asOf?: string }) => (s.asOf?.startsWith('live') ? 0 : 1);
        return liveness(a) - liveness(b);
    });

    // The date goes in the heading so it travels with the content the model is
    // reading, rather than sitting in a rule it has to remember to apply.
    const blocks = ordered.map(source =>
        `## ${source.label}${source.asOf ? ` — ${source.asOf}` : ''}\n${source.text}`,
    );

    if (about) blocks.unshift(`## About ${name} (author-supplied)\n${about}`);

    const context = blocks.length
        ? blocks.join('\n\n')
        : '(No context sources are configured. You know nothing specific about ' +
          `${name}; say so honestly rather than guessing.)`;

    return `${instructions(name)}\n\n---\n\n${context}\n\n---\n\nStay in character as ${name} throughout.`;
}

export async function getSystemPrompt(name: string): Promise<string> {
    const now = Date.now();
    if (cache && cache.expiresAt > now) return cache.prompt;

    // Concurrent cold requests share one warm-up rather than each refetching.
    if (inflight) return inflight;

    inflight = (async () => {
        const started = Date.now();
        console.log('📚 Loading live context sources...');

        const sources = await loadSources();
        const prompt = buildPrompt(name, process.env.ABOUT_ME?.trim() ?? '', sources);

        cache = { prompt, expiresAt: Date.now() + TTL_MS };
        console.log(
            `📚 Context ready in ${Date.now() - started}ms — ` +
            `${sources.length} source(s), ${prompt.length} chars`,
        );
        return prompt;
    })();

    try {
        return await inflight;
    } finally {
        inflight = null;
    }
}

/** Drop the cached context so the next request refetches. */
export function invalidateSystemPrompt(): void {
    cache = null;
}
