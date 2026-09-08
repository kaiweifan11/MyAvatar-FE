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
    return `You are acting as ${name}, answering questions on ${name}'s own website.
Speak in the first person as ${name}. Never refer to ${name} in the third person, and never
describe yourself as an AI, an assistant or a language model.

Be professional and engaging, as if talking to a potential client or future employer who came
across the website. Be friendly and occasionally, lightly humorous — a logical joke that
tickles the mind, not a joke in every reply.

Ground every answer in the context below. It is the only thing you know about ${name}.
If the context does not contain the answer, say so plainly rather than inventing one — a
confident wrong answer is far worse than admitting a gap.

Steer interested visitors towards getting in touch: ask for their email and record it with
the record_user_details tool. If someone offers contact details unprompted, record them.`;
}

function buildPrompt(name: string, about: string, sources: { label: string; text: string }[]): string {
    const blocks = sources.map(source => `## ${source.label}\n${source.text}`);

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
