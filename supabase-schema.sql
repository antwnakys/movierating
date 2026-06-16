-- ============================================================
--  CineRate — Supabase schema
--  Run this in your Supabase project: SQL Editor → New query → Run
-- ============================================================

create table if not exists public.ratings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  user_name   text not null,
  movie_id    bigint not null,
  movie_title text not null,
  movie_poster text,
  movie_year  text,
  -- 0.5 .. 5.0 in half-star steps
  rating      numeric(2,1) not null
              check (rating >= 0.5 and rating <= 5 and (rating * 2) = floor(rating * 2)),
  review      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, movie_id)
);

create index if not exists ratings_movie_id_idx on public.ratings (movie_id);
create index if not exists ratings_user_id_idx  on public.ratings (user_id);

-- Row Level Security
alter table public.ratings enable row level security;

-- Anyone may read all ratings (needed for community averages & reviews)
drop policy if exists "Ratings are viewable by everyone" on public.ratings;
create policy "Ratings are viewable by everyone"
  on public.ratings for select
  using (true);

-- A user may only write/edit/delete their own rows
drop policy if exists "Users insert own ratings" on public.ratings;
create policy "Users insert own ratings"
  on public.ratings for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own ratings" on public.ratings;
create policy "Users update own ratings"
  on public.ratings for update
  using (auth.uid() = user_id);

drop policy if exists "Users delete own ratings" on public.ratings;
create policy "Users delete own ratings"
  on public.ratings for delete
  using (auth.uid() = user_id);

-- ============================================================
--  Watchlist — movies a user saves to watch later (private)
-- ============================================================
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

-- A watchlist is private: each user only sees and manages their own.
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
