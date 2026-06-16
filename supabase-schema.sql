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
  rating      int  not null check (rating between 1 and 5),
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
