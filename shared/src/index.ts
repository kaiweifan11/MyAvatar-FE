/**
 * Contract shared by the client and the server.
 *
 * Phase 3 will grow this considerably — presentation sessions, slides and
 * question queues are all read by both sides. Keeping the shared package small
 * but real from the start is why the workspace exists (decision D6).
 */

/** Longest single question accepted. Enforced on both sides. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Turns of history carried into the model call. */
export const MAX_HISTORY_MESSAGES = 20;

/** Shown when the relevance gate rejects an off-topic question. Reads like
 *  Kaiwei brushing off a tangent, not like a content filter. */
export const OFF_TOPIC_REPLY =
    "Ha — I'm flattered, but I'm only really useful on the subject of me. " +
    'Ask me about my background, my work, the projects I have built, or how to get in touch.';

export interface ChatErrorResponse {
    error: string;
}

// ---------------------------------------------------------------------------
// Presentation Q&A
// ---------------------------------------------------------------------------

export interface Slide {
    /** 1-based, matching what the presenter sees in their deck. */
    number: number;
    /** Visible text on the slide. */
    text: string;
    /**
     * Speaker notes, where present.
     *
     * Usually the richest signal in a deck — bullets are headlines, notes are
     * what the presenter actually intended to say. Only PPTX carries them; a
     * PDF export discards notes entirely, which is why both formats are
     * supported rather than just PDF.
     */
    notes?: string;
}

export interface Deck {
    /** Original filename, shown to the presenter so they know what is loaded. */
    name: string;
    slides: Slide[];
    /** True when at least one slide had speaker notes. */
    hasNotes: boolean;
}

/** Decks are sent with each question, so cap what a huge deck contributes. */
export const MAX_DECK_CHARS = 40_000;

/**
 * Flattens a deck into the text handed to the model.
 *
 * Slide numbers are kept so the avatar can say "that's on slide 7", which is
 * far more useful to a room than an unattributed answer.
 */
export function formatDeck(deck: Deck): string {
    const body = deck.slides
        .map(slide => {
            const parts = [`--- Slide ${slide.number} ---`];
            if (slide.text) parts.push(slide.text);
            if (slide.notes) parts.push(`[Speaker notes] ${slide.notes}`);
            return parts.join('\n');
        })
        .join('\n\n');

    return `Presentation: ${deck.name} (${deck.slides.length} slides)\n\n${body}`
        .slice(0, MAX_DECK_CHARS);
}

/** Trims a question to the accepted length. */
export function clampMessage(message: string): string {
    return message.slice(0, MAX_MESSAGE_LENGTH);
}
