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

/** Trims a question to the accepted length. */
export function clampMessage(message: string): string {
    return message.slice(0, MAX_MESSAGE_LENGTH);
}
