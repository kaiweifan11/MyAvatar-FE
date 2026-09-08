import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import {
    convertToModelMessages,
    generateText,
    createUIMessageStream,
    pipeUIMessageStreamToResponse,
    stepCountIs,
    streamText,
    toUIMessageStream,
    type UIMessage,
} from 'ai';
import {
    MAX_HISTORY_MESSAGES,
    MAX_MESSAGE_LENGTH,
    OFF_TOPIC_REPLY,
    type Deck,
} from '@myavatar/shared';
import { chatModel, webSearchTool } from './model';
import { tools } from './tools';
import { getSystemPrompt } from './utils/getSystemPrompt';
import { getQaPrompt } from './utils/getQaPrompt';
import { checkQaRelevance, QA_DEFLECTION } from './utils/qaGate';
import { rateLimit } from './utils/rateLimit';
import { checkRelevance } from './utils/relevanceGate';
import { reportUnansweredQuestion } from './utils/unknownQuestion';
import { verifyNotificationChannels } from './utils/notify';

const app = express();
const port = process.env.PORT || 3001;

// Identity comes from the environment so this repo carries no personal detail.
const NAME = process.env.AVATAR_NAME?.trim() || 'the site owner';

/** Guard against a tool loop that never settles. */
const MAX_STEPS = 6;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

/** Flattens a UIMessage's text parts back into a plain string. */
function messageText(message: UIMessage): string {
    return message.parts
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('')
        .trim();
}

/**
 * Emits a fixed reply through the UI message stream, so the client renders a
 * refusal on exactly the same path as a real answer.
 */
function cannedReplyStream(text: string) {
    return createUIMessageStream({
        execute: ({ writer }) => {
            const id = 'canned-reply';
            writer.write({ type: 'text-start', id });
            writer.write({ type: 'text-delta', id, delta: text });
            writer.write({ type: 'text-end', id });
        },
    });
}

// ===== /health route =====
// Also the wake-up endpoint: the free tier spins down after 15 minutes idle,
// so this gets pinged before a presentation to absorb the cold start.
app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, uptime: process.uptime() });
});

// ===== /chat route =====
app.post('/chat', rateLimit, async (req: Request, res: Response) => {
    const messages: UIMessage[] = Array.isArray(req.body?.messages)
        ? req.body.messages
        : [];

    const lastMessage = messages.at(-1);
    if (!lastMessage || lastMessage.role !== 'user') {
        return res.status(400).json({ error: 'Expected a trailing user message.' });
    }

    const userMessage = messageText(lastMessage);
    if (!userMessage) {
        return res.status(400).json({ error: 'Empty message.' });
    }

    if (userMessage.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
            error: `That is a bit long - keep questions under ${MAX_MESSAGE_LENGTH} characters.`,
        });
    }

    try {
        // Cheap filter before the expensive call: blocks general-purpose LLM use
        // and prompt-injection attempts.
        const { allowed } = await checkRelevance(userMessage);
        if (!allowed) {
            console.log('Off-topic question blocked:', userMessage.slice(0, 120));
            await pipeUIMessageStreamToResponse({
                response: res,
                stream: cannedReplyStream(OFF_TOPIC_REPLY),
            });
            return;
        }

        const system = await getSystemPrompt(NAME);

        const result = streamText({
            model: chatModel,
            system,
            // Cap the window so a long conversation cannot grow unbounded.
            messages: await convertToModelMessages(messages.slice(-MAX_HISTORY_MESSAGES)),
            // Web search is opt-in: it bills per call. With a thin public
            // footprint it is what lets the avatar answer anything recent.
            tools: webSearchTool ? { ...tools, web_search: webSearchTool } : tools,
            stopWhen: stepCountIs(MAX_STEPS),
            // Backstop for record_unknown_question, which the model often
            // declines to call — see utils/unknownQuestion.ts. Runs after the
            // answer has streamed, so it cannot affect the response.
            onFinish: ({ text, steps }) => {
                const toolsCalled = steps.flatMap(step =>
                    step.toolCalls.map(call => call.toolName),
                );
                void reportUnansweredQuestion(userMessage, text, toolsCalled);
            },
        });

        await pipeUIMessageStreamToResponse({
            response: res,
            stream: toUIMessageStream({ stream: result.fullStream }),
        });
    } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        // Headers are already sent once streaming has begun, so only a
        // pre-stream failure can still produce a clean error response.
        if (!res.headersSent) {
            res.status(500).json({ error: 'Something went wrong processing your message.' });
        } else {
            res.end();
        }
    }
});

// ===== /ready route =====
/**
 * Pre-presentation checklist, in one call.
 *
 * Every failure this reports has already happened silently in this project:
 * expired API credits took the avatar offline with no warning, a non-public
 * Drive link fed a sign-in page in place of the resume, and unset SMTP meant
 * contact capture reported success while dropping everything. Each of those
 * looked identical to "working" until someone asked a question.
 *
 * So this wakes the service, rebuilds context, and spends a few tokens on a
 * real model call — the only way to prove the key works and has credit.
 */
app.get('/ready', async (_req: Request, res: Response) => {
    const checks: { name: string; ok: boolean; detail: string }[] = [];

    let sourceCount = 0;
    try {
        const prompt = await getSystemPrompt(NAME);
        sourceCount = (prompt.match(/^## /gm) ?? []).length;
        checks.push({
            name: 'Context',
            ok: sourceCount > 0,
            detail: sourceCount > 0
                ? `${sourceCount} source(s), ${prompt.length} chars`
                : 'no sources loaded',
        });
    } catch (err) {
        checks.push({
            name: 'Context',
            ok: false,
            detail: err instanceof Error ? err.message : 'failed to load',
        });
    }

    try {
        const { text } = await generateText({
            model: chatModel,
            prompt: 'Reply with the single word: ready',
            maxOutputTokens: 16,
        });
        checks.push({ name: 'Model', ok: true, detail: `responded (${text.trim().slice(0, 20)})` });
    } catch (err) {
        // Almost always an expired key or an exhausted balance.
        const message = err instanceof Error ? err.message : String(err);
        checks.push({ name: 'Model', ok: false, detail: message.slice(0, 160) });
    }

    const notifyConfigured = Boolean(
        (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) ||
        (process.env.PUSHOVER_TOKEN && process.env.PUSHOVER_USER),
    );
    checks.push({
        name: 'Notifications',
        ok: notifyConfigured,
        detail: notifyConfigured ? 'configured' : 'not configured - contact capture is dropped',
    });

    res.json({ ok: checks.every(check => check.ok), checks });
});

// ===== /present route =====
// Live presentation Q&A. Separate from /chat because the persona, the grounding
// order and the failure mode are all different — see utils/getQaPrompt.ts.
app.post('/present', rateLimit, async (req: Request, res: Response) => {
    const messages: UIMessage[] = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const deck: Deck | undefined = req.body?.deck;

    const lastMessage = messages.at(-1);
    if (!lastMessage || lastMessage.role !== 'user') {
        return res.status(400).json({ error: 'Expected a trailing user message.' });
    }

    if (!deck?.slides?.length) {
        return res.status(400).json({ error: 'No presentation loaded.' });
    }

    const question = messageText(lastMessage);
    if (!question) return res.status(400).json({ error: 'Empty question.' });

    if (question.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
            error: `That is a bit long - keep questions under ${MAX_MESSAGE_LENGTH} characters.`,
        });
    }

    try {
        // A gate, but not the website's. That one asks "is this about Kaiwei?"
        // and would block the talk's own subject. This one is given the deck's
        // topics and blocks task requests instead — the presenter types in
        // questions the audience asks, so "write me a JavaScript alert" reaches
        // the projector otherwise.
        const { allowed } = await checkQaRelevance(question, deck);
        if (!allowed) {
            console.log('Off-topic Q&A question blocked:', question.slice(0, 120));
            await pipeUIMessageStreamToResponse({
                response: res,
                stream: cannedReplyStream(QA_DEFLECTION),
            });
            return;
        }

        const bioContext = await getSystemPrompt(NAME);

        const result = streamText({
            model: chatModel,
            system: getQaPrompt(NAME, bioContext, deck),
            messages: await convertToModelMessages(messages.slice(-MAX_HISTORY_MESSAGES)),
            stopWhen: stepCountIs(MAX_STEPS),
        });

        await pipeUIMessageStreamToResponse({
            response: res,
            stream: toUIMessageStream({ stream: result.fullStream }),
        });
    } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Something went wrong answering that.' });
        } else {
            res.end();
        }
    }
});

// ===== Start Server =====
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    // Surface a broken notification setup at boot rather than the first time
    // someone leaves their email and it silently goes nowhere.
    void verifyNotificationChannels();
});
