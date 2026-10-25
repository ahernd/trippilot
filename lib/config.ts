// One place for every setting you may want to change.

// Which company runs the chat model: 'google' (free tier) or 'openrouter' (paid).
// Change it here, or set LLM_PROVIDER in .env.local.
export const PROVIDER: 'google' | 'openrouter' =
  process.env.LLM_PROVIDER === 'openrouter' ? 'openrouter' : 'google';

// Model names. FAST is for normal turns and the eval judge. SMART is for harder planning.
// Google: run scripts/list-gemini-models.ts to see the exact names your key can use.
// OpenRouter: check names on https://openrouter.ai/models
export const MODELS = {
  google: {
    fast: 'gemini-3.6-flash',
    smart: 'gemini-3.6-flash', // Pro models are not on the free tier, so both use Flash
  },
  openrouter: {
    fast: 'anthropic/claude-haiku-5.5',
    smart: 'anthropic/claude-sonnet-5.5',
  },
};

// Cities that exist in the demo data. Coordinates are used for live weather.
export const CITIES: Record<string, { lat: number; lon: number }> = {
  Pune: { lat: 18.52, lon: 73.86 },
  Mumbai: { lat: 19.08, lon: 72.88 },
  Delhi: { lat: 28.61, lon: 77.21 },
  Goa: { lat: 15.3, lon: 74.08 },
  Bengaluru: { lat: 12.97, lon: 77.59 },
};

// Policy search: a result below this score is treated as "no policy found".
export const POLICY_MIN_SIMILARITY = 0.6;

// Limits
export const MAX_STEPS = 6; // agent steps per turn
export const MAX_INPUT_CHARS = 1000; // longest user message we accept
export const MAX_RESULTS = 5; // flights or hotels shown per search
