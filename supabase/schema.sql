create extension if not exists pgcrypto;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  nickname text not null unique,
  best_distance numeric not null default 0,
  best_questions integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nickname_length check (char_length(nickname) between 2 and 20)
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'running' check (status in ('running','failed','completed')),
  distance numeric not null default 0,
  questions_passed integer not null default 0,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists players_best_distance_idx on public.players(best_distance desc);
create index if not exists runs_player_id_idx on public.runs(player_id);

alter table public.players enable row level security;
alter table public.runs enable row level security;

-- The browser does NOT connect directly to these tables.
-- All reads/writes go through Next.js server routes using SUPABASE_SERVICE_ROLE_KEY.
-- Therefore no anonymous RLS policy is required.
