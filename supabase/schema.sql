-- COURTSIDE database schema for Supabase / PostgreSQL.
-- The game server currently saves to server/data/db.json (works out of the box).
-- This schema is the hosted version of the same data, with Row Level Security.
-- To use it: create a Supabase project, run this file in the SQL editor,
-- then write a Supabase version of server/db.ts (same functions, same tables).

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 3 and 16),
  friend_code text unique not null,
  rep integer not null default 0,
  coins integer not null default 150,
  loadout jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists player_statistics (
  player_id uuid primary key references profiles(id) on delete cascade,
  games int default 0, wins int default 0, losses int default 0,
  pts int default 0, reb int default 0, ast int default 0, stl int default 0, blk int default 0,
  fga int default 0, fgm int default 0, tpa int default 0, tpm int default 0, perfect int default 0,
  streak int default 0, best_streak int default 0, shootout_best int default 0, dunk_best numeric default 0
);

create table if not exists friends (
  player_id uuid references profiles(id) on delete cascade,
  friend_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (player_id, friend_id)
);

create table if not exists friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid references profiles(id) on delete cascade,
  to_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (from_id, to_id)
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  mode text not null,
  winner smallint not null,          -- 0 home, 1 away, -1 none
  score_home int not null, score_away int not null,
  duration_s int not null,
  extra_score numeric,               -- shootout / dunk contest score
  created_at timestamptz default now()
);

create table if not exists match_players (
  match_id uuid references matches(id) on delete cascade,
  player_id uuid references profiles(id) on delete set null,
  name text not null, team smallint not null, is_bot boolean not null default false,
  pts int, reb int, ast int, stl int, blk int,
  primary key (match_id, name)
);

create table if not exists rivalries (
  a_id uuid references profiles(id) on delete cascade,
  b_id uuid references profiles(id) on delete cascade,
  a_wins int default 0, b_wins int default 0,
  streak_owner uuid, streak int default 0, best_a int default 0, best_b int default 0,
  recent jsonb default '[]'::jsonb,
  primary key (a_id, b_id),
  check (a_id < b_id)
);

create table if not exists inventory (
  player_id uuid references profiles(id) on delete cascade,
  item_id text not null,
  acquired_at timestamptz default now(),
  primary key (player_id, item_id)
);

create table if not exists player_settings (
  player_id uuid primary key references profiles(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb
);

create table if not exists blocks (
  player_id uuid references profiles(id) on delete cascade,
  blocked_id uuid references profiles(id) on delete cascade,
  primary key (player_id, blocked_id)
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  from_id uuid references profiles(id) on delete set null,
  target_id uuid references profiles(id) on delete cascade,
  reason text, created_at timestamptz default now()
);

-- ------------------------------------------------------------------ Row Level Security
-- Players can read public info, but only change their own settings and loadout.
-- Scores, stats, REP, coins, matches and rivalries are written ONLY by the game server
-- (it uses the service role key, which bypasses RLS). Clients can never write them.
alter table profiles enable row level security;
alter table player_statistics enable row level security;
alter table friends enable row level security;
alter table friend_requests enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;
alter table rivalries enable row level security;
alter table inventory enable row level security;
alter table player_settings enable row level security;
alter table blocks enable row level security;
alter table reports enable row level security;

create policy "profiles readable by signed-in players" on profiles for select using (auth.role() = 'authenticated');
create policy "stats readable" on player_statistics for select using (auth.role() = 'authenticated');
create policy "matches readable" on matches for select using (auth.role() = 'authenticated');
create policy "match players readable" on match_players for select using (auth.role() = 'authenticated');
create policy "own friends" on friends for select using (auth.uid() = player_id);
create policy "own requests" on friend_requests for select using (auth.uid() in (from_id, to_id));
create policy "send request" on friend_requests for insert with check (auth.uid() = from_id);
create policy "delete own request" on friend_requests for delete using (auth.uid() in (from_id, to_id));
create policy "own rivalries" on rivalries for select using (auth.uid() in (a_id, b_id));
create policy "own inventory" on inventory for select using (auth.uid() = player_id);
create policy "own settings read" on player_settings for select using (auth.uid() = player_id);
create policy "own settings write" on player_settings for insert with check (auth.uid() = player_id);
create policy "own settings update" on player_settings for update using (auth.uid() = player_id);
create policy "own blocks" on blocks for all using (auth.uid() = player_id) with check (auth.uid() = player_id);
create policy "file reports" on reports for insert with check (auth.uid() = from_id);
-- note: profiles.name/loadout updates go through the server so loadouts can be checked against what the player owns.
