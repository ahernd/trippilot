// Lists the Gemini models your key can use for chat.
// Run: npx tsx --env-file=.env.local scripts/list-gemini-models.ts

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is missing. Run with --env-file=.env.local');

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': key },
  });
  if (!res.ok) throw new Error(`Google error ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data: any = await res.json();
  const chatModels = (data.models ?? []).filter((m: any) =>
    (m.supportedGenerationMethods ?? []).includes('generateContent')
  );
  console.log('Models you can use for chat (copy the name after "models/"):\n');
  for (const m of chatModels) {
    console.log(`${String(m.name).replace('models/', '').padEnd(42)} ${m.displayName ?? ''}`);
  }
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
