-- TripPilot database schema
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- All flight, hotel and policy data in this project is synthetic demo data.

create extension if not exists vector;

-- ---------- Tables ----------

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  home_city text,
  seat_pref text
);

create table if not exists flights (
  id bigint generated always as identity primary key,
  origin text not null,
  destination text not null,
  depart_at timestamptz not null,
  arrive_at timestamptz not null,
  airline text,
  price_inr int,
  seats_left int
);

create table if not exists hotels (
  id bigint generated always as identity primary key,
  city text not null,
  name text not null,
  price_per_night_inr int,
  rating numeric,
  rooms_left int
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  kind text check (kind in ('flight','hotel')) not null,
  item_id bigint not null,
  status text default 'confirmed',
  idempotency_key text unique,
  created_at timestamptz default now()
);

create table if not exists policies (
  id bigint generated always as identity primary key,
  title text not null,
  content text not null,
  embedding vector(384)
);

create table if not exists agent_runs (
  id bigint generated always as identity primary key,
  user_id uuid,
  input text,
  tool_calls jsonb,
  latency_ms int,
  tokens int,
  created_at timestamptz default now()
);

-- Helpful indexes for the searches the agent makes
create index if not exists flights_route_idx on flights (origin, destination, depart_at);
create index if not exists hotels_city_idx on hotels (city, price_per_night_inr);
create index if not exists bookings_user_idx on bookings (user_id);

-- ---------- RAG search function ----------

create or replace function match_policies(
  query_embedding vector(384),
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

-- ---------- Row-level security ----------
-- The server uses the secret key, which bypasses these rules.
-- The browser uses the publishable key, which must obey them.

alter table profiles   enable row level security;
alter table bookings   enable row level security;
alter table agent_runs enable row level security;
alter table flights    enable row level security;
alter table hotels     enable row level security;
alter table policies   enable row level security;

drop policy if exists "own profile"  on profiles;
drop policy if exists "own bookings" on bookings;
drop policy if exists "public read flights"  on flights;
drop policy if exists "public read hotels"   on hotels;
drop policy if exists "public read policies" on policies;

create policy "own profile"  on profiles for all using (auth.uid() = id);
create policy "own bookings" on bookings for all using (auth.uid() = user_id);

-- Catalogue tables: anyone may read, nobody may write from the browser.
create policy "public read flights"  on flights  for select using (true);
create policy "public read hotels"   on hotels   for select using (true);
create policy "public read policies" on policies for select using (true);

-- agent_runs has no policy on purpose: only the server can touch it.
