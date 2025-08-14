import { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources";
import { record_user_details, record_unknown_question } from "../tools";

export async function handleToolCall(
    messages: ChatCompletionMessageParam[],
    toolCalls: ChatCompletionMessageToolCall[]
): Promise<void> {
    for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function' || !toolCall.function) continue;

        const args = JSON.parse(toolCall.function.arguments);
        let toolResult: any;

        if (toolCall.function.name === 'record_user_details') {
            toolResult = await record_user_details(args);
        } else if (toolCall.function.name === 'record_unknown_question') {
            toolResult = await record_unknown_question(args);
        } else {
            toolResult = { error: 'Unknown tool' };
        }

        messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
        });
    }
}