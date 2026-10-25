drop function if exists match_policies(vector, int);

alter table policies drop column embedding;
alter table policies add column embedding vector(768);

create or replace function match_policies(
  query_embedding vector(768),
  match_count int default 3
)
returns table (id bigint, title text, content text, similarity float)
language sql stable as $$
  select id, title, content, 1 - (embedding <=> query_embedding) as similarity
  from policies
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;