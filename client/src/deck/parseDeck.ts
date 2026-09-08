import JSZip from 'jszip';
import type { Deck, Slide } from '@myavatar/shared';

/**
 * Deck parsing, in the browser.
 *
 * Slides never reach the server (decision D8): they are parsed here and the
 * extracted text travels with each question. That keeps unreleased material off
 * a third-party host, and sidesteps the free tier's 512MB / 0.1 CPU budget,
 * which a 50MB PPTX would not survive.
 *
 * Speaker notes are a bonus, not the plan. Most decks have none, so the slide
 * content itself has to carry the answer — which means chasing text into the
 * places PowerPoint hides it.
 */

/** Strips XML tags, keeping the breaks that carry meaning. */
function xmlToText(xml: string): string {
    return xml
        // Paragraph and line breaks inside a shape.
        .replace(/<a:br\s*\/>/g, '\n')
        .replace(/<\/a:p>/g, '\n')
        // Separate shapes, table cells and rows, so a title does not run into
        // the bullet beneath it and cells do not merge into one line.
        .replace(/<\/p:sp>/g, '\n')
        .replace(/<\/a:tc>/g, ' | ')
        .replace(/<\/a:tr>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/[ \t]+/g, ' ')
        // Each table cell ends with a paragraph, so the cell separator lands
        // after a newline and every cell drops onto its own line. Pull the
        // separator back up so a row reads as a row.
        .replace(/\n\s*\|/g, ' |')
        .split('\n')
        .map(line => line.replace(/\s*\|\s*$/, '').trim())
        .filter(Boolean)
        .join('\n');
}

/** slide12.xml -> 12, so slides come back in presentation order. */
function slideIndex(path: string): number {
    return Number(path.match(/(\d+)\.xml$/)?.[1] ?? 0);
}

/**
 * Every part a slide points at, resolved from its relationships file.
 *
 * notesSlideN does NOT reliably correspond to slideN — PowerPoint numbers notes
 * parts in creation order, so as soon as some slides lack notes the sequences
 * diverge and slide 5 may own notesSlide2. The rels file is the only correct
 * mapping, and it also names the diagram and chart parts, which is how we find
 * text that is not in the slide XML at all.
 */
async function slideRelationships(
    zip: JSZip,
    slidePath: string,
): Promise<{ notes?: string; extras: string[] }> {
    const relsPath = slidePath.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
    const relsFile = zip.files[relsPath];
    if (!relsFile) return { extras: [] };

    const rels = await relsFile.async('string');
    const resolve = (target: string) => `ppt/${target.replace(/^\.\.\//, '')}`;

    const notes = rels
        .match(/Target="([^"]*notesSlide\d+\.xml)"/i)?.[1];

    // SmartArt lives in ppt/diagrams/dataN.xml and charts in ppt/charts/chartN.xml.
    // Neither puts its text in the slide, so a diagram-heavy deck parses as
    // almost empty without this.
    const extras = [...rels.matchAll(/Target="([^"]*(?:diagrams\/data|charts\/chart)\d+\.xml)"/gi)]
        .map(match => resolve(match[1]!));

    return { ...(notes ? { notes: resolve(notes) } : {}), extras };
}

/** Chart parts keep labels in <a:t> and cell values in <c:v>. */
function chartToText(xml: string): string {
    const labels = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]!);
    const values = [...xml.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map(m => m[1]!);

    const seen = new Set<string>();
    return [...labels, ...values]
        .map(value => value.trim())
        .filter(value => {
            if (!value || seen.has(value)) return false;
            seen.add(value);
            return true;
        })
        .join(', ');
}

async function parsePptx(file: File): Promise<Deck> {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());

    const slidePaths = Object.keys(zip.files)
        .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
        .sort((a, b) => slideIndex(a) - slideIndex(b));

    if (slidePaths.length === 0) {
        throw new Error('No slides found — is this a valid .pptx file?');
    }

    const slides: Slide[] = [];

    for (const [index, path] of slidePaths.entries()) {
        // The slide's position in the deck, not its part number: those diverge
        // once slides are deleted, and the presenter needs the number they can
        // actually see.
        const number = index + 1;
        const parts: string[] = [xmlToText(await zip.files[path]!.async('string'))];

        const { notes: notesPath, extras } = await slideRelationships(zip, path);

        for (const extraPath of extras) {
            const extraFile = zip.files[extraPath];
            if (!extraFile) continue;

            const xml = await extraFile.async('string');
            const text = extraPath.includes('/charts/')
                ? chartToText(xml)
                : xmlToText(xml);

            if (text) {
                parts.push(
                    `${extraPath.includes('/charts/') ? '[Chart]' : '[Diagram]'} ${text}`,
                );
            }
        }

        let notes: string | undefined;
        const notesFile = notesPath ? zip.files[notesPath] : undefined;
        if (notesFile) {
            // PowerPoint renders the slide number into the notes placeholder,
            // which would otherwise surface as a note reading just "7".
            const cleaned = xmlToText(await notesFile.async('string'))
                .split('\n')
                .filter(line => !/^\d{1,3}$/.test(line.trim()))
                .join('\n')
                .trim();
            if (cleaned) notes = cleaned;
        }

        slides.push({
            number,
            text: parts.filter(Boolean).join('\n'),
            ...(notes ? { notes } : {}),
        });
    }

    return {
        name: file.name,
        slides,
        hasNotes: slides.some(slide => Boolean(slide.notes)),
    };
}

async function parsePdf(file: File): Promise<Deck> {
    // Imported lazily so the PDF engine is not in the initial bundle — most
    // visitors never open the presentation route at all.
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url,
    ).toString();

    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const slides: Slide[] = [];

    for (let number = 1; number <= doc.numPages; number++) {
        const page = await doc.getPage(number);
        const content = await page.getTextContent();

        const text = content.items
            .map(item => ('str' in item ? item.str : ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        slides.push({ number, text });
    }

    // A PDF export has no notes track at all — worth surfacing, because the
    // presenter may not realise what was lost by exporting.
    return { name: file.name, slides, hasNotes: false };
}

export async function parseDeck(file: File): Promise<Deck> {
    const name = file.name.toLowerCase();

    if (name.endsWith('.pptx')) return parsePptx(file);
    if (name.endsWith('.pdf')) return parsePdf(file);

    throw new Error(
        'Unsupported file. Upload a .pptx (keeps your speaker notes) or a .pdf.',
    );
}
