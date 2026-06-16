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
  -- Overall score: simple rating, or the average of the 5 aspects below.
  -- A detailed average can be e.g. 4.2, so only the range is enforced here.
  rating      numeric(2,1) not null check (rating >= 0.5 and rating <= 5),
  -- 'simple' = one rating; 'detailed' = the 5 aspects below
  mode        text not null default 'simple' check (mode in ('simple', 'detailed')),
  rating_movie     numeric(2,1),
  rating_directing numeric(2,1),
  rating_acting    numeric(2,1),
  rating_music     numeric(2,1),
  rating_scenario  numeric(2,1),
  review      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, movie_id),
  -- each aspect: null or a valid half-step 0.5..5
  constraint ratings_aspects_valid check (
    (rating_movie     is null or (rating_movie     between 0.5 and 5 and (rating_movie     * 2) = floor(rating_movie     * 2))) and
    (rating_directing is null or (rating_directing between 0.5 and 5 and (rating_directing * 2) = floor(rating_directing * 2))) and
    (rating_acting    is null or (rating_acting    between 0.5 and 5 and (rating_acting    * 2) = floor(rating_acting    * 2))) and
    (rating_music     is null or (rating_music     between 0.5 and 5 and (rating_music     * 2) = floor(rating_music     * 2))) and
    (rating_scenario  is null or (rating_scenario  between 0.5 and 5 and (rating_scenario  * 2) = floor(rating_scenario  * 2)))
  ),
  -- detailed mode requires all five aspects
  constraint ratings_detailed_complete check (
    mode = 'simple' or (
      rating_movie is not null and rating_directing is not null and rating_acting is not null
      and rating_music is not null and rating_scenario is not null
    )
  )
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
