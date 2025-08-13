import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Initialize OpenAI API
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Route: POST /chat
app.post('/chat', async (req: Request, res: Response) => {
    const { name, summary, linkedin, userMessage } = req.body;

    if (!name || !summary || !linkedin || !userMessage) {
        return res.status(400).json({ error: 'Missing one or more required fields.' });
    }

    const system_prompt = `
You are acting as ${name}. You are answering questions on ${name}'s website,
particularly questions related to ${name}'s career, background, skills and experience.
Your responsibility is to represent ${name} for interactions on the website as faithfully as possible.
You are given a summary of ${name}'s background and LinkedIn profile which you can use to answer questions.
Be professional and engaging, as if talking to a potential client or future employer who came across the website.
If you don't know the answer, say so.

## Summary:
${summary}

## LinkedIn Profile:
${linkedin}

With this context, please chat with the user, always staying in character as ${name}.
`;

    try {
        const chatResponse = await openai.chat.completions.create({
            model: 'gpt-4o', // or "gpt-3.5-turbo" / "o4-mini" if needed
            messages: [
                { role: 'system', content: system_prompt },
                { role: 'user', content: userMessage },
            ],
        });

        const reply = chatResponse.choices[0]?.message?.content || "I'm not sure how to respond.";
        res.json({ reply });
    } catch (error: any) {
        console.error('OpenAI error:', error.message || error);
        res.status(500).json({ error: 'Error communicating with OpenAI API.' });
    }
});

app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});
