import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import OpenAI from 'openai';
import { tools } from './tools';
import { getSystemPrompt } from './utils/getSystemPrompt';
import { handleToolCall } from './utils/handleToolCall';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ===== 🔹 Initialize OpenAI =====
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ===== 🔹 /chat route =====
app.post('/chat', async (req: Request, res: Response) => {
    const { userMessage, history = [] } = req.body;
    const name = 'Fan Kaiwei';
    const githubUsername = 'kaiweifan11';

    if (!userMessage) return res.status(400).json({ error: 'Missing "userMessage".' });

    try {
        const system_prompt = await getSystemPrompt(name, githubUsername);

        const messages: any[] = [
            { role: 'system', content: system_prompt },
            ...history,
            { role: 'user', content: userMessage },
        ];

        let done = false;
        let finalReply = "I'm not sure how to respond.";

        console.log('system_prompt', system_prompt)
        while (!done) {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages,
                tools,
                tool_choice: 'auto',
            });


            const message = response.choices[0].message!;
            const finishReason = response.choices[0].finish_reason;

            console.log('message', message.content)


            if (finishReason === 'tool_calls' && message.tool_calls) {
                messages.push(message);
                await handleToolCall(messages, message.tool_calls);
            } else {
                // No more tool calls, finish
                done = true;
                finalReply = message.content || finalReply;
            }
        }

        res.json({ reply: finalReply });
    } catch (err: any) {
        console.error('❌ Error:', err.message || err);
        res.status(500).json({ error: 'Something went wrong processing your message.' });
    }
});

// ===== 🔹 Start Server =====
app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});