import { notify } from './notify';

/**
 * Safety net for capturing questions the avatar could not answer.
 *
 * The model has a `record_unknown_question` tool, but measured behaviour is
 * that it frequently declines to call it — it answers "I don't have that
 * information" helpfully and records nothing. Relying on the model's
 * tool-calling discipline loses exactly the data that makes this feature worth
 * having: the log of what people actually want to know.
 *
 * So the tool stays (when it fires, it gives a clean question string) and this
 * backstops it by inspecting the finished answer. No extra model call, so it
 * costs nothing.
 */

/**
 * Phrases signalling a lack of *knowledge*, or a refusal to answer — not a lack
 * of possession. "I don't have a car" is a real answer; "I don't have that
 * information" is not. Hence the anchoring on information/details/specifics
 * rather than a bare "I don't have".
 */
const NON_ANSWER_PATTERNS: RegExp[] = [
    /\bi\s+(?:don'?t|do not)\s+have\b[^.]{0,60}\b(?:information|details?|specifics?|records?|data)\b/i,
    /\bi\s+(?:don'?t|do not)\s+have\s+that\s+(?:information|detail)\b/i,
    /\bi\s+(?:don'?t|do not)\s+know\b/i,
    /\bi'?m\s+not\s+sure\b/i,
    /\bi'?m\s+afraid\s+i\s+(?:don'?t|do not|can'?t|cannot)\b/i,
    /\bdidn'?t\s+make\s+it\s+into\s+my\s+(?:bio|summary|profile)\b/i,
    /\bi\s+(?:can'?t|cannot)\s+(?:provide|share|recall)\b/i,
    /\bno\s+(?:information|details?)\s+(?:about|on)\b/i,
    /\bnot\s+something\s+i\s+(?:have|can)\b/i,
    /\btoo\s+personal\b/i,
];

/**
 * Models write curly apostrophes ("I’m afraid I can’t"), so patterns matching
 * only the ASCII form silently miss most real answers — which is exactly what
 * happened the first time this shipped.
 */
function normalise(text: string): string {
    return text
        .replace(/[‘’ʼ]/g, "'")
        .replace(/[“”]/g, '"');
}

export function looksLikeNonAnswer(text: string): boolean {
    const normalised = normalise(text);
    return NON_ANSWER_PATTERNS.some(pattern => pattern.test(normalised));
}

/**
 * Notifies when the avatar failed to answer, unless the model already recorded
 * it itself. Fire-and-forget: this runs after the response has streamed, so a
 * failure here must never surface to the visitor.
 */
export async function reportUnansweredQuestion(
    question: string,
    answer: string,
    toolsCalled: string[],
): Promise<void> {
    if (toolsCalled.includes('record_unknown_question')) return;
    if (!looksLikeNonAnswer(answer)) return;

    try {
        await notify('MyAvatar: question I could not answer', question);
    } catch (err) {
        console.error('Failed to report unanswered question:', err);
    }
}
