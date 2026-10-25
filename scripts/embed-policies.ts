// Loads data/policies.json, embeds each policy, and stores it in Supabase.
// Run: npx tsx --env-file=.env.local scripts/embed-policies.ts
// Safe to run again: it clears the policies table first, so there are no duplicates.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { embed } from '../lib/embed';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase keys. Run with --env-file=.env.local');
  const supabase = createClient(url, key);

  const docs: { title: string; content: string }[] = JSON.parse(
    readFileSync('data/policies.json', 'utf8')
  );
  console.log(`Read ${docs.length} policies.`);

  // Start clean so a second run does not create duplicates.
  const { error: delError } = await supabase.from('policies').delete().gte('id', 0);
  if (delError) throw new Error(`Could not clear policies: ${delError.message}`);

  let done = 0;
  for (const d of docs) {
    const embedding = await embed(`${d.title}. ${d.content}`, 'document');
    await new Promise((r) => setTimeout(r, 700)); // stay under the free speed limit
    const { error } = await supabase
      .from('policies')
      .insert({ title: d.title, content: d.content, embedding });
    if (error) throw new Error(`${d.title}: ${error.message}`);
    done++;
    console.log(`${done}/${docs.length}  ${d.title}`);
  }
  console.log(`Done. ${done} policies stored with embeddings.`);
}

main().catch((e) => {
  console.error('Embed failed:', e.message);
  process.exit(1);
});
