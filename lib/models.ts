// Picks the chat model. The rest of the app calls getModel('fast') and never
// needs to know which company is behind it.

import { createGoogle } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { MODELS, PROVIDER } from './config';

export function getModel(tier: 'fast' | 'smart' = 'fast') {
  if (PROVIDER === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY is missing');
    return createOpenRouter({ apiKey: key }).chat(MODELS.openrouter[tier]);
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is missing');
  return createGoogle({ apiKey: key })(MODELS.google[tier]);
}
