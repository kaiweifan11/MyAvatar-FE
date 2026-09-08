import { createOpenAI } from '@ai-sdk/openai';

/**
 * Central model configuration.
 *
 * The AI SDK is provider-agnostic (decision D4), so swapping the answering
 * brain to a different provider is a change here plus one import — that swap
 * is deliberately deferred to the Phase 1 eval bake-off.
 *
 * Two models on purpose: the gate runs on every message and emits one token,
 * so it stays cheap; the brain answers as Kaiwei, so it should be good.
 */

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const chatModel = openai(process.env.CHAT_MODEL ?? 'gpt-4o-mini');
export const gateModel = openai(process.env.GATE_MODEL ?? 'gpt-4o-mini');

/**
 * OpenAI's server-side web search, enabled only when ENABLE_WEB_SEARCH is set.
 *
 * Off by default because it bills per call on top of tokens. It matters more
 * than it looks: with little public material to load at warm-up, this is the
 * avatar's only route to anything recent or unindexed.
 */
export const webSearchTool =
    process.env.ENABLE_WEB_SEARCH === 'true' ? openai.tools.webSearch({}) : undefined;
