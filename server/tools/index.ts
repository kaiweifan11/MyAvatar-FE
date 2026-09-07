import { tool } from 'ai';
import { z } from 'zod';
import { push } from '../utils/push';

export const tools = {
    record_user_details: tool({
        description: "Record a user's interest in contacting Fan Kaiwei.",
        inputSchema: z.object({
            email: z.string().describe('Email address of the user'),
            name: z.string().describe('Name of the user'),
            notes: z.string().describe('Extra notes about what they are interested in'),
        }),
        execute: async ({ email, name, notes }) => {
            await push(`📩 New interest from ${name} (${email}): ${notes}`);
            return { success: true };
        },
    }),

    record_unknown_question: tool({
        description: "Record a question that the assistant doesn't know how to answer.",
        inputSchema: z.object({
            question: z
                .string()
                .describe('The unknown question the assistant could not answer'),
        }),
        execute: async ({ question }) => {
            await push(`❓ Unknown question received: ${question}`);
            return { recorded: true };
        },
    }),
};
