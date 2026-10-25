// Times several Gemini models, one after another, and shows which are fast enough.
// Run: npx tsx --env-file=.env.local scripts/bench-models.ts
// It can take a few minutes. Each test stops after 30 seconds.

import { generateText, isStepCount } from 'ai';
import { createGoogle } from '@ai-sdk/google';
import { createTools } from '../lib/tools';

const CANDIDATES = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secs = (t0: number) => ((Date.now() - t0) / 1000).toFixed(1) + 's';

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is missing. Run with --env-file=.env.local');
  const google = createGoogle({ apiKey: key });
  const tools = createTools(null);

  console.log('model'.padEnd(26), 'plain answer'.padEnd(16), 'tool call'.padEnd(34));
  for (const name of CANDIDATES) {
    let plain = '';
    let tool = '';

    let t0 = Date.now();
    try {
      await generateText({
        model: google(name),
        prompt: 'Say hello in one short sentence.',
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(30_000),
      });
      plain = secs(t0);
    } catch (e: any) {
      plain = 'FAIL ' + String(e?.message ?? e).slice(0, 20);
    }

    await sleep(7000); // stay under the free speed limit

    t0 = Date.now();
    try {
      const r = await generateText({
        model: google(name),
        instructions: 'You are a travel assistant. Use tools for facts. Never guess weather.',
        prompt: 'What is the weather in Goa today?',
        tools: { get_weather: tools.get_weather },
        stopWhen: isStepCount(3),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(30_000),
      });
      const used = r.steps.some((s) => s.toolCalls.length > 0);
      tool = `${secs(t0)} ${used ? 'tool used' : 'NO TOOL USED'}`;
    } catch (e: any) {
      tool = 'FAIL ' + String(e?.message ?? e).slice(0, 26);
    }

    console.log(name.padEnd(26), plain.padEnd(16), tool);
    await sleep(7000);
  }
}

main().catch((e) => {
  console.error('Failed:', e?.message ?? e);
  process.exit(1);
});
