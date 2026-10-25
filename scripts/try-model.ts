// Checks that the chat model works AND can call a tool.
// Run: npx tsx --env-file=.env.local scripts/try-model.ts

import { generateText, isStepCount } from 'ai';
import { getModel } from '../lib/models';
import { createTools } from '../lib/tools';
import { PROVIDER, MODELS } from '../lib/config';

async function main() {
  console.log(`Provider: ${PROVIDER}, model: ${MODELS[PROVIDER].fast}\n`);
  const tools = createTools(null);

  const result = await generateText({
    model: getModel('fast'),
    instructions: 'You are a travel assistant. Use tools for facts. Never guess weather.',
    prompt: 'What is the weather in Goa today?',
    tools: { get_weather: tools.get_weather },
    stopWhen: isStepCount(3),
  });

  console.log('Tool calls made:', result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)));
  console.log('\nAnswer:\n' + result.text);
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
