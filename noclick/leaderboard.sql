-- No Clicking's daily leaderboard, for the Supabase project the game's server talks to.
-- The server (noclick/board.mjs) reads and writes with the service key, so the table has row level security on and
-- no public policies: browsers never touch it directly. One row per device per day; posting again updates it.
create table if not exists public.noclick_scores (
  id bigint generated always as identity primary key,
  day date not null,
  device_hash text not null,
  name text not null check (char_length(name) between 2 and 16),
  par int not null check (par between 1 and 60),
  strokes int not null check (strokes between 1 and 100),
  score int not null,
  tapes int[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day, device_hash)
);
create index if not exists noclick_scores_day_rank on public.noclick_scores (day, score, strokes, updated_at);
alter table public.noclick_scores enable row level security;
