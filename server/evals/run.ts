import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs, type LanguageModel } from 'ai';
import { cases, type EvalCase } from './cases';
import { tools } from '../tools';
import { getSystemPrompt } from '../utils/getSystemPrompt';
import { checkRelevance } from '../utils/relevanceGate';
import { looksLikeNonAnswer } from '../utils/unknownQuestion';

/**
 * Eval runner for the avatar.
 *
 * Usage:
 *   pnpm --filter server eval                        # default model
 *   pnpm --filter server eval -- --model gpt-5-mini  # bake-off
 *   pnpm --filter server eval -- --only facts,tools  # subset
 *
 * Every run costs real money. Cost is reported at the end.
 */

// Tools notify via Pushover on execute; suppress that during evals.
process.env.EVAL_MODE = '1';

const NAME = process.env.AVATAR_NAME?.trim() || 'the site owner';
const MAX_STEPS = 6;

const args = process.argv.slice(2);
function arg(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}

const modelId = arg('--model') ?? process.env.CHAT_MODEL ?? 'gpt-4o-mini';
const judgeId = arg('--judge') ?? 'gpt-4o-mini';
const onlyCategories = arg('--only')?.split(',').map(s => s.trim());

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model: LanguageModel = openai(modelId);
const judge: LanguageModel = openai(judgeId);

interface CaseResult {
    id: string;
    category: string;
    passed: boolean;
    observeOnly: boolean;
    failures: string[];
    answer: string;
    gateVerdict: 'ALLOW' | 'BLOCK';
    toolsCalled: string[];
    judgeNote?: string;
}

const usage = { input: 0, output: 0 };

function contains(haystack: string, needle: string): boolean {
    return haystack.toLowerCase().includes(needle.toLowerCase());
}

async function judgeAnswer(
    testCase: EvalCase,
    answer: string,
): Promise<{ pass: boolean; note: string }> {
    const { text, usage: u } = await generateText({
        model: judge,
        system:
            'You grade a persona chatbot that answers as Fan Kaiwei on his personal website. ' +
            'Reply with PASS or FAIL on the first line, then one short sentence of justification. ' +
            'If the criterion says OBSERVATION ONLY, always reply PASS and simply describe what the answer did.',
        prompt: `Criterion: ${testCase.rubric}\n\nQuestion: ${testCase.question}\n\nAnswer:\n${answer}`,
        maxOutputTokens: 120,
        temperature: 0,
    });

    usage.input += u.inputTokens ?? 0;
    usage.output += u.outputTokens ?? 0;

    const [verdict, ...rest] = text.trim().split('\n');
    return {
        pass: !/^fail/i.test(verdict?.trim() ?? ''),
        note: rest.join(' ').trim() || (verdict ?? '').trim(),
    };
}

async function runCase(testCase: EvalCase, system: string): Promise<CaseResult> {
    const failures: string[] = [];
    const expectedGate = testCase.gate ?? 'ALLOW';

    const { allowed } = await checkRelevance(testCase.question);
    const gateVerdict: 'ALLOW' | 'BLOCK' = allowed ? 'ALLOW' : 'BLOCK';

    if (gateVerdict !== expectedGate) {
        failures.push(`gate expected ${expectedGate}, got ${gateVerdict}`);
    }

    // A blocked question never reaches the model, so there is nothing else to grade.
    if (gateVerdict === 'BLOCK') {
        return {
            id: testCase.id,
            category: testCase.category,
            passed: failures.length === 0,
            observeOnly: testCase.observeOnly ?? false,
            failures,
            answer: '(blocked by relevance gate)',
            gateVerdict,
            toolsCalled: [],
        };
    }

    const result = await generateText({
        model,
        system,
        prompt: testCase.question,
        tools,
        stopWhen: stepCountIs(MAX_STEPS),
        // Pinned so scores are reproducible and model comparisons mean
        // something. Production runs at the provider default; this trades a
        // little realism for the ability to tell a real regression from noise.
        temperature: 0,
    });

    usage.input += result.usage.inputTokens ?? 0;
    usage.output += result.usage.outputTokens ?? 0;

    const answer = result.text;
    const toolsCalled = result.steps.flatMap(step =>
        step.toolCalls.map(call => call.toolName),
    );

    for (const group of testCase.mustMention ?? []) {
        if (!group.some(variant => contains(answer, variant))) {
            failures.push(`missing any of: ${group.join(' | ')}`);
        }
    }

    for (const forbidden of testCase.mustNotMention ?? []) {
        if (contains(answer, forbidden)) failures.push(`should not say: "${forbidden}"`);
    }

    if (
        testCase.mustCaptureUnknown &&
        !toolsCalled.includes('record_unknown_question') &&
        !looksLikeNonAnswer(answer)
    ) {
        failures.push('unanswered question was not captured (no tool call, and the ' +
            'answer did not read as a non-answer)');
    }

    if (testCase.mustCallTool && !toolsCalled.includes(testCase.mustCallTool)) {
        failures.push(
            `expected tool ${testCase.mustCallTool}, called: ${toolsCalled.join(', ') || 'none'}`,
        );
    }

    let judgeNote: string | undefined;
    if (testCase.rubric) {
        const verdict = await judgeAnswer(testCase, answer);
        judgeNote = verdict.note;
        if (!verdict.pass) failures.push(`judge: ${verdict.note}`);
    }

    return {
        id: testCase.id,
        category: testCase.category,
        passed: failures.length === 0,
        observeOnly: testCase.observeOnly ?? false,
        failures,
        answer,
        gateVerdict,
        toolsCalled,
        judgeNote,
    };
}

async function main() {
    const selected = onlyCategories
        ? cases.filter(c => onlyCategories.includes(c.category))
        : cases;

    console.log(`\nModel: ${modelId}   Judge: ${judgeId}   Cases: ${selected.length}\n`);

    const system = await getSystemPrompt(NAME);
    const results: CaseResult[] = [];

    for (const testCase of selected) {
        const result = await runCase(testCase, system);
        results.push(result);

        const mark = result.observeOnly ? 'OBS ' : result.passed ? 'PASS' : 'FAIL';
        console.log(`${mark}  ${result.id}`);
        for (const failure of result.failures) console.log(`        ${failure}`);
        if (!result.passed && !result.observeOnly) {
            console.log(`        answer: ${result.answer.replace(/\s+/g, ' ').slice(0, 300)}`);
        }
        if (result.observeOnly) {
            console.log(`        ${result.answer.replace(/\s+/g, ' ').slice(0, 220)}`);
        }
    }

    // Observation-only cases are reported but never counted.
    const graded = results.filter(r => !r.observeOnly);
    const passed = graded.filter(r => r.passed).length;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`SCORE  ${passed}/${graded.length}  (${Math.round((passed / graded.length) * 100)}%)   model=${modelId}`);

    const byCategory = new Map<string, { pass: number; total: number }>();
    for (const r of graded) {
        const entry = byCategory.get(r.category) ?? { pass: 0, total: 0 };
        entry.total++;
        if (r.passed) entry.pass++;
        byCategory.set(r.category, entry);
    }
    for (const [category, { pass, total }] of byCategory) {
        console.log(`  ${category.padEnd(12)} ${pass}/${total}`);
    }

    console.log(
        `\nTokens: ${usage.input} in / ${usage.output} out ` +
        `(cost depends on model; gpt-4o-mini is roughly $0.15/$0.60 per 1M)`,
    );

    const failedIds = graded.filter(r => !r.passed).map(r => r.id);
    if (failedIds.length) console.log(`\nFailed: ${failedIds.join(', ')}`);

    process.exit(failedIds.length > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Eval run failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
