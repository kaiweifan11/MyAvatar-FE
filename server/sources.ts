import pdfParse from 'pdf-parse';

/**
 * Live, public context sources.
 *
 * Everything here is fetched at warm-up from URLs supplied by environment
 * variables. Nothing is stored, nothing is scheduled, and no personal content
 * lives in this repo — that is the whole point of Phase 2.
 *
 * A source that fails is logged and skipped. One dead link must never take the
 * avatar down, because the failure would surface live in front of an audience.
 */

export interface Source {
    label: string;
    text: string;
}

/** A slow URL must not hold up the warm-up indefinitely. */
const FETCH_TIMEOUT_MS = Number(process.env.SOURCE_FETCH_TIMEOUT_MS ?? 10_000);

/** Cap per source so one enormous page cannot dominate the context window. */
const MAX_CHARS_PER_SOURCE = Number(process.env.SOURCE_MAX_CHARS ?? 20_000);

function envList(name: string): string[] {
    return (process.env[name] ?? '')
        .split(/[,\n]/)
        .map(entry => entry.trim())
        .filter(Boolean);
}

/**
 * Google Drive share links serve an HTML preview page, not the file. Rewrite
 * them to the direct-download form, otherwise a pasted "share" URL silently
 * yields a page of markup instead of a resume.
 */
function normaliseUrl(url: string): string {
    const driveFile = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (driveFile) {
        return `https://drive.google.com/uc?export=download&id=${driveFile[1]}`;
    }

    const driveOpen = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
    if (driveOpen) {
        return `https://drive.google.com/uc?export=download&id=${driveOpen[1]}`;
    }

    // Google Docs published as a document — ask for plain text.
    const gdoc = url.match(/docs\.google\.com\/document\/d\/([^/]+)/);
    if (gdoc) {
        return `https://docs.google.com/document/d/${gdoc[1]}/export?format=txt`;
    }

    return url;
}

/** Crude but dependency-free HTML to text. Good enough for a profile page. */
function htmlToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim();
}

async function fetchWithTimeout(url: string): Promise<Response> {
    return fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
        headers: { 'User-Agent': 'MyAvatar/2.0 (personal site assistant)' },
    });
}

/** Fetches any URL and reduces it to plain text, by content type. */
async function fetchAsText(url: string): Promise<string> {
    const response = await fetchWithTimeout(normaliseUrl(url));
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
        const buffer = Buffer.from(await response.arrayBuffer());
        return (await pdfParse(buffer)).text.trim();
    }

    const body = await response.text();
    return contentType.includes('html') ? htmlToText(body) : body.trim();
}

/**
 * A GitHub profile URL expands into something worth reading: the profile
 * fields, and the public repositories with their descriptions.
 */
async function fetchGithubProfile(username: string): Promise<string> {
    // See dataLoaders history: a token is optional and not needed at this
    // volume, but is used when present.
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const parts: string[] = [];

    const profileRes = await fetch(`https://api.github.com/users/${username}`, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (profileRes.ok) {
        const profile = (await profileRes.json()) as Record<string, unknown>;
        const fields = (['name', 'bio', 'company', 'location', 'blog'] as const)
            .map(field => [field, profile[field]] as const)
            .filter(([, value]) => typeof value === 'string' && value.trim())
            .map(([field, value]) => `${field}: ${value}`);
        if (fields.length) parts.push(fields.join('\n'));
    }

    const reposRes = await fetch(
        `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`,
        { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );

    if (reposRes.ok) {
        const repos = await reposRes.json();
        if (Array.isArray(repos) && repos.length) {
            parts.push(
                'Public repositories:\n' +
                repos
                    .map(repo => `- ${repo.name}: ${repo.description || 'No description'}`)
                    .join('\n'),
            );
        }
    }

    if (!parts.length) throw new Error('no readable GitHub profile data');
    return parts.join('\n\n');
}

async function loadOne(url: string): Promise<Source> {
    const github = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/?$/i);

    const text = github
        ? await fetchGithubProfile(github[1]!)
        : await fetchAsText(url);

    return { label: url, text: text.slice(0, MAX_CHARS_PER_SOURCE) };
}

/**
 * Loads every configured source concurrently.
 *
 * `RESUME_URL` is separate from `SOURCE_URLS` only so it can be labelled
 * clearly in the prompt — the resume is the densest source, and the model
 * answers better when it knows what it is reading.
 */
export async function loadSources(): Promise<Source[]> {
    const configured: { label: string; url: string }[] = [];

    const resumeUrl = process.env.RESUME_URL?.trim();
    if (resumeUrl) configured.push({ label: 'Resume', url: resumeUrl });

    for (const url of envList('SOURCE_URLS')) {
        configured.push({ label: url, url });
    }

    if (!configured.length) {
        console.warn(
            '⚠️ No sources configured. Set RESUME_URL and/or SOURCE_URLS, ' +
            'or the avatar knows only what ABOUT_ME tells it.',
        );
        return [];
    }

    const settled = await Promise.allSettled(
        configured.map(async ({ label, url }) => {
            const source = await loadOne(url);
            return { label, text: source.text };
        }),
    );

    const sources: Source[] = [];
    settled.forEach((result, index) => {
        const { label, url } = configured[index]!;
        if (result.status === 'fulfilled' && result.value.text) {
            console.log(`  ✔ ${label} (${result.value.text.length} chars)`);
            sources.push(result.value);
        } else {
            const reason =
                result.status === 'rejected'
                    ? (result.reason instanceof Error ? result.reason.message : result.reason)
                    : 'empty response';
            // Non-fatal by design: a dead link must not break a live Q&A.
            console.warn(`  ✘ ${label} <${url}> — ${reason}`);
        }
    });

    return sources;
}
