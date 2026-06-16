-- ============================================================
--  CineRate migration — half-star ratings + watchlist
--  Run this ONCE in Supabase → SQL Editor on a project that
--  already has the original schema. Safe to run as a whole.
-- ============================================================

-- 1) Allow half-star (0.5-step) ratings ----------------------
-- Drop the old 1-5 integer check FIRST so it can't block the type change,
-- then cast explicitly (USING), then add the half-step check.
alter table public.ratings
  drop constraint if exists ratings_rating_check;

alter table public.ratings
  alter column rating type numeric(2,1) using rating::numeric(2,1);

alter table public.ratings
  add constraint ratings_rating_check
  check (rating >= 0.5 and rating <= 5 and (rating * 2) = floor(rating * 2));

-- 2) Watchlist table -----------------------------------------
create table if not exists public.watchlist (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  movie_id     bigint not null,
  movie_title  text not null,
  movie_poster text,
  movie_year   text,
  created_at   timestamptz not null default now(),
  unique (user_id, movie_id)
);

create index if not exists watchlist_user_id_idx on public.watchlist (user_id);

alter table public.watchlist enable row level security;

drop policy if exists "Users view own watchlist" on public.watchlist;
create policy "Users view own watchlist"
  on public.watchlist for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own watchlist" on public.watchlist;
create policy "Users insert own watchlist"
  on public.watchlist for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own watchlist" on public.watchlist;
create policy "Users delete own watchlist"
  on public.watchlist for delete
  using (auth.uid() = user_id);
