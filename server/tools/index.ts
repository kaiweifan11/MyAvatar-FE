import { ChatCompletionTool } from 'openai/resources';
import { push } from '../utils/push';

export const tools: ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "record_user_details",
            description: "Record a user's interest in contacting Fan Kaiwei.",
            parameters: {
                type: "object",
                properties: {
                    email: {
                        type: "string",
                        description: "Email address of the user",
                    },
                    name: {
                        type: "string",
                        description: "Name of the user",
                    },
                    notes: {
                        type: "string",
                        description: "Extra notes about what they are interested in",
                    },
                },
                required: ["email", "name", "notes"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "record_unknown_question",
            description: "Record a question that the assistant doesn't know how to answer.",
            parameters: {
                type: "object",
                properties: {
                    question: {
                        type: "string",
                        description: "The unknown question the assistant could not answer",
                    },
                },
                required: ["question"],
            },
        },
    },
];

export async function record_user_details({
    email,
    name,
    notes,
}: {
    email: string;
    name: string;
    notes: string;
}) {
    await push(`📩 New interest from ${name} (${email}): ${notes}`);
    return { success: true };
}

export async function record_unknown_question({
    question,
}: {
    question: string;
}) {
    await push(`❓ Unknown question received: ${question}`);
    return { recorded: true };
}
