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
            await notify(
                `MyAvatar: new contact from ${name}`,
                `Name:  ${name}\nEmail: ${email}\n\nNotes:\n${notes}`,
            );
            return { success: true };
        },
    }),
};
