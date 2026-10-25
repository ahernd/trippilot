// Tests policy search from the command line.
// Run: npx tsx --env-file=.env.local scripts/try-search.ts "your question here"

import { createClient } from '@supabase/supabase-js';
import { embed } from '../lib/embed';

async function main() {
  const question = process.argv.slice(2).join(' ') || 'Can I get a refund if I cancel my flight tomorrow?';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase keys. Run with --env-file=.env.local');
  const supabase = createClient(url, key);

  console.log(`Question: ${question}\n`);
  const query_embedding = await embed(question, 'query');
  const { data, error } = await supabase.rpc('match_policies', {
    query_embedding,
    match_count: 3,
  });
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    console.log(`${row.similarity.toFixed(3)}  ${row.title}`);
    console.log(`       ${row.content}\n`);
  }
}

main().catch((e) => {
  console.error('Search failed:', e.message);
  process.exit(1);
});
