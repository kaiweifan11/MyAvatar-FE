import { tool } from 'ai';
import { z } from 'zod';
import { notify } from '../utils/notify';

/**
 * `record_unknown_question` used to live here and was removed deliberately.
 *
 * It proved unreliable in both directions: the model frequently declined to
 * call it when it genuinely could not answer, and called it with its own
 * clarifying questions when it could — so every contact request also produced
 * a spurious "could not answer" notification. Tightening the tool description
 * did not fix either behaviour.
 *
 * Unanswered questions are now detected server-side in
 * utils/unknownQuestion.ts, which does not depend on the model choosing to
 * call anything.
 */
export const tools = {
    record_user_details: tool({
        description:
            "Record a visitor's interest in getting in touch. Call this whenever a " +
            'visitor supplies an email address, or asks to be contacted.',
        inputSchema: z.object({
            email: z.string().describe('Email address of the visitor'),
            name: z.string().describe('Name of the visitor'),
            notes: z.string().describe('Extra notes about what they are interested in'),
        }),
        execute: async ({ email, name, notes }) => {
            // The model invents placeholders. Asked "have you been mentioned
            // online recently?" it called this with {"email":"user@example.com",
            // "name":"User"} and would have sent a contact notification for a
            // question containing no contact details at all. Validate here
            // rather than trusting the model to only call this when it should.
            if (!isRealContact(email)) {
                console.warn(`Ignoring fabricated contact details: ${email}`);
                return { success: false, reason: 'No real contact details were provided.' };
            }

            await notify(
                `MyAvatar: new contact from ${name}`,
                `Name:  ${name}\nEmail: ${email}\n\nNotes:\n${notes}`,
            );
            return { success: true };
        },
    }),
};

/** Domains and local parts that only ever appear in invented examples. */
const PLACEHOLDER_DOMAINS = [
    'example.com', 'example.org', 'example.net', 'test.com', 'domain.com',
    'email.com', 'yourdomain.com', 'company.com', 'sample.com',
];
const PLACEHOLDER_LOCALS = [
    'user', 'test', 'email', 'name', 'your', 'yourname', 'someone', 'visitor',
    'noreply', 'no-reply', 'unknown',
];

function isRealContact(email: string): boolean {
    const trimmed = (email ?? '').trim().toLowerCase();

    // Deliberately loose: the goal is to catch invented placeholders, not to
    // police unusual but valid addresses.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) return false;

    const [local, domain] = trimmed.split('@') as [string, string];
    if (PLACEHOLDER_DOMAINS.includes(domain)) return false;
    if (PLACEHOLDER_LOCALS.includes(local)) return false;

    return true;
}
