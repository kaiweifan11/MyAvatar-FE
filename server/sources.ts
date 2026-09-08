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
    /**
     * How current this source is, in words the model can reason about.
     *
     * This exists because sources disagree. A resume is a snapshot from the day
     * it was written; a LinkedIn profile reflects today. Told only "prefer the
     * most recent", the model still favoured the resume's stale employer
     * because it was the more detailed source. Given actual dates, it has
     * something concrete to compare.
     */
    asOf?: string;
}

/** Converts a PDF date ("D:20250911231323+00'00'") to a plain ISO date. */
function pdfDate(raw: unknown): string | undefined {
    const m = typeof raw === 'string' ? raw.match(/^D:(\d{4})(\d{2})(\d{2})/) : null;
    return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** Pulls a YYYYMMDD out of a filename like FanKaiweiResume_20250901.pdf. */
function filenameDate(disposition: string | null): string | undefined {
    const m = disposition?.match(/(\d{4})(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
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

/**
 * A private Google Drive or Docs link returns HTTP 200 with a sign-in page,
 * not the file. Treating that as success is worse than failing: a login page
 * would be handed to the model as if it were the resume. Detect it and fail
 * loudly instead.
 */
function assertNotAuthWall(url: string, finalUrl: string, body: string): void {
    const redirectedToLogin = /accounts\.google\.com|\/ServiceLogin/i.test(finalUrl);
    const looksLikeLoginPage =
        /Sign in to continue to Google (Drive|Docs)/i.test(body) ||
        /<title>\s*(Google Drive|Google Docs)\s*-\s*Sign in/i.test(body);

    if (redirectedToLogin || looksLikeLoginPage) {
        throw new Error(
            'the link is not public — Google returned a sign-in page. In Drive, use ' +
            'Share > General access > "Anyone with the link".',
        );
    }

    if (/drive\.google\.com|docs\.google\.com/i.test(url) && /virus scan warning/i.test(body)) {
        throw new Error('Google served a virus-scan interstitial instead of the file.');
    }

    // Instagram and Facebook return a login wall to logged-out fetchers:
    // Instagram answers 200 with ~600KB of JavaScript and no profile metadata,
    // Facebook answers 400. Unlike LinkedIn, neither publishes anything useful
    // for search engines. Without this check the Instagram page would be
    // reduced to 20,000 characters of script noise and fed to the model as if
    // it were a profile.
    if (/instagram\.com|facebook\.com|threads\.net/i.test(url)) {
        const hasProfileMetadata = /<meta property="og:description" content="[^"]{40,}/i.test(body);
        if (!hasProfileMetadata) {
            throw new Error(
                'no public profile data — the site serves a login wall to logged-out ' +
                'visitors and publishes no metadata for search engines.',
            );
        }
    }
}

/** Fetches any URL and reduces it to plain text, with its date where known. */
async function fetchAsText(url: string): Promise<{ text: string; asOf?: string }> {
    const response = await fetchWithTimeout(normaliseUrl(url));
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Sniff the content rather than trusting the content-type header or the
    // file extension. Google Drive's direct-download URL has no .pdf suffix
    // and does not report a PDF content type, so header-based detection
    // silently fed raw "%PDF-1.5 ... FlateDecode" bytes into the prompt.
    if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
        const parsed = await pdfParse(buffer);
        // Prefer the filename's date (authors usually version it deliberately),
        // then the PDF's own creation date, then the server's last-modified.
        const asOf =
            filenameDate(response.headers.get('content-disposition')) ??
            pdfDate((parsed.info as Record<string, unknown> | undefined)?.CreationDate) ??
            (response.headers.get('last-modified')
                ? new Date(response.headers.get('last-modified')!).toISOString().slice(0, 10)
                : undefined);
        return { text: parsed.text.trim(), asOf };
    }

    const body = buffer.toString('utf-8');
    assertNotAuthWall(url, response.url, body);

    const contentType = response.headers.get('content-type') ?? '';
    const isHtml = contentType.includes('html') || /^\s*<(!doctype|html)/i.test(body);

    // A Google document link that comes back as a web page did not give us
    // the file — usually a sharing or link-format problem.
    if (/drive\.google\.com|docs\.google\.com/i.test(url) && isHtml) {
        throw new Error(
            'expected a document but got a web page — check the link is public and ' +
            'points directly at the file.',
        );
    }

    return { text: isHtml ? htmlToText(body) : body.trim() };
}

/**
 * A GitHub profile URL expands into something worth reading: the profile
 * fields, and the public repositories with their descriptions.
 */
async function fetchGithubProfile(username: string): Promise<string> {
    // GITHUB_TOKEN is optional and deliberately undocumented in .env.example.
    // This is two API calls per context build, and the build is cached hourly,
    // so it sits well inside the 60/hour anonymous limit. README fetching was
    // tried here and removed: twelve more calls per build to find READMEs in
    // only four of twelve repos is not worth requiring a token for, and the
    // repo names and descriptions are what the public profile page shows
    // anyway. The anonymous limit is keyed on source IP, so on shared hosting
    // that 60 is shared with other tenants — hence still honouring a token.
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

/**
 * A LinkedIn profile page is ~570KB and reduces to roughly 20,000 characters of
 * navigation, sign-in prompts and cookie policy wrapped around a few hundred
 * characters of fact. Fetched as a generic page it would add ~5,000 tokens of
 * noise to every request.
 *
 * So read only what LinkedIn publishes *for search engines* — the og: tags and
 * the JSON-LD Person block. Same facts, a fraction of the size, and it does not
 * touch anything behind the auth wall.
 *
 * Note that LinkedIn masks some fields for logged-out viewers, returning job
 * titles as "******** ***". Those are dropped rather than shown to the model.
 */
function extractLinkedInProfile(html: string): string {
    const lines: string[] = [];
    const meta = (prop: string) =>
        html.match(
            new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`, 'i'),
        )?.[1];

    const decode = (value: string) =>
        value
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
            .trim();

    const redacted = (value: unknown): boolean =>
        typeof value !== 'string' || /\*{3,}/.test(value) || !value.trim();

    const title = meta('og:title');
    if (title) lines.push(decode(title));

    const description = meta('description') ?? meta('og:description');
    if (description) lines.push(decode(description));

    const ld = html.match(
        /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i,
    )?.[1];

    if (ld) {
        try {
            const parsed = JSON.parse(ld.trim());
            const nodes: any[] = parsed['@graph'] ?? [parsed];
            const person = nodes.find(node => node?.['@type'] === 'Person');

            if (person) {
                const employers = (person.worksFor ?? [])
                    .map((org: any) => org?.name)
                    .filter((name: unknown) => !redacted(name));
                if (employers.length) lines.push(`Works for: ${employers.join(', ')}`);

                const schools = (person.alumniOf ?? [])
                    .map((school: any) => {
                        const years = school?.member?.startDate
                            ? ` (${school.member.startDate}-${school.member.endDate ?? ''})`
                            : '';
                        return redacted(school?.name) ? null : `${school.name}${years}`;
                    })
                    .filter(Boolean);
                if (schools.length) lines.push(`Education: ${schools.join(', ')}`);

                const locality = person.address?.addressLocality;
                if (!redacted(locality)) lines.push(`Location: ${locality}`);
            }
        } catch {
            // Structured data is a bonus; the og: tags already carry the facts.
        }
    }

    if (!lines.length) throw new Error('no public profile metadata found');
    return lines.join('\n');
}

/**
 * Reads a shared Google Drive folder as a list of filenames.
 *
 * Deliberately does not download the files. This folder holds certificates,
 * which are image-based scans — pdf-parse recovers about 150 characters of
 * noise from each. The information that actually survives is the filename,
 * because that is where the credential is named. So enumerate, do not parse:
 * twelve names instead of twelve near-empty PDF fetches.
 *
 * Drive renders the folder listing into the page HTML for logged-out visitors,
 * so no API key or authentication is involved.
 */
function extractDriveFolder(html: string): { name: string; files: string[] } {
    const folderName = html
        .match(/<title>([^<]*)<\/title>/i)?.[1]
        ?.replace(/\s*[–-]\s*Google Drive\s*$/i, '')
        .trim() ?? 'Google Drive folder';

    const seen = new Set<string>();
    const files: string[] = [];

    for (const match of html.matchAll(/"((?:[^"\\]|\\.){4,120}?\.(?:pdf|jpe?g|png|docx?|txt|md))"/gi)) {
        const raw = match[1]!;
        // Skip Google's own page assets, which are URLs rather than filenames.
        if (/^https?:|\/\/|gstatic|googleusercontent/i.test(raw)) continue;

        const name = raw
            .replace(/\\u0026/g, '&')
            .replace(/\\u([0-9a-f]{4})/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))
            .replace(/\\(.)/g, '$1')
            // The extension carries no meaning once we are not parsing the file.
            .replace(/\.(pdf|jpe?g|png|docx?|txt|md)$/i, '')
            .replace(/[_]+/g, ' ')
            .trim();

        if (!name || seen.has(name)) continue;
        seen.add(name);
        files.push(name);
    }

    if (!files.length) {
        throw new Error(
            'no files listed — check the folder is shared with "Anyone with the link".',
        );
    }

    return { name: folderName, files };
}

async function loadOne(url: string): Promise<Source> {
    const driveFolder = url.match(/drive\.google\.com\/drive\/folders\/([^/?#]+)/i);
    if (driveFolder) {
        const response = await fetchWithTimeout(url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

        const { name, files } = extractDriveFolder(await response.text());
        return {
            label: name,
            text: `${name} (${files.length} items):\n` +
                files.map(file => `- ${file}`).join('\n'),
            asOf: 'live, fetched just now',
        };
    }

    const github = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/?$/i);
    if (github) {
        const text = await fetchGithubProfile(github[1]!);
        return {
            label: url,
            text: text.slice(0, MAX_CHARS_PER_SOURCE),
            asOf: 'live, fetched just now',
        };
    }

    if (/^https?:\/\/([a-z]{2}\.)?(www\.)?linkedin\.com\/in\//i.test(url)) {
        const response = await fetchWithTimeout(url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return {
            label: url,
            text: extractLinkedInProfile(await response.text()),
            asOf: 'live profile, fetched just now',
        };
    }

    const { text, asOf } = await fetchAsText(url);
    return { label: url, text: text.slice(0, MAX_CHARS_PER_SOURCE), asOf };
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
            // A loader that discovered a better name for the source — a Drive
            // folder's title, say — wins over the raw URL, since the heading is
            // what tells the model what it is reading.
            return {
                label: source.label !== url ? source.label : label,
                text: source.text,
                asOf: source.asOf,
            };
        }),
    );

    const sources: Source[] = [];
    settled.forEach((result, index) => {
        const { label, url } = configured[index]!;
        if (result.status === 'fulfilled' && result.value.text) {
            const dated = result.value.asOf ? `, ${result.value.asOf}` : '';
            console.log(`  ✔ ${label} (${result.value.text.length} chars${dated})`);
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
