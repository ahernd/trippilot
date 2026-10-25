// Turns text into 768 numbers (an "embedding") using Google's free Gemini embedding model.
// Texts with similar meaning get similar numbers, so we can search by meaning.
//
// kind = 'document' when storing a policy, 'query' when embedding a user's question.
// Google tunes the numbers differently for each, which gives better search results.

const MODEL = 'gemini-embedding-001';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`;
export const EMBEDDING_SIZE = 768;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function embed(
  text: string,
  kind: 'document' | 'query' = 'document'
): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is missing. Add it to .env.local and run with --env-file=.env.local');

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${MODEL}`,
        content: { parts: [{ text }] },
        taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        outputDimensionality: EMBEDDING_SIZE,
      }),
    });

    if (res.ok) {
      const data: any = await res.json();
      const vector: number[] | undefined = data?.embedding?.values;
      if (!vector) throw new Error(`No embedding in response: ${JSON.stringify(data).slice(0, 300)}`);
      if (vector.length !== EMBEDDING_SIZE) {
        throw new Error(`Expected ${EMBEDDING_SIZE} numbers but got ${vector.length}`);
      }
      return vector;
    }

    // Free tier has a speed limit (429). Wait and try again.
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(attempt * 5000);
      continue;
    }
    const body = await res.text();
    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`);
  }
  throw new Error('Embedding failed after 4 tries');
}
