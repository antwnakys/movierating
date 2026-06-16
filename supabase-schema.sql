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

-- ============================================================
--  Profiles — public profile, avatar, bio, top 5 movies
-- ============================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  bio          text,
  top_movies   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "Profiles are public" on public.profiles;
create policy "Profiles are public" on public.profiles for select using (true);
drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);

-- ============================================================
--  Follows — directed follower → following edges
-- ============================================================
create table if not exists public.follows (
  follower_id  uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id);
alter table public.follows enable row level security;
drop policy if exists "Follows are public" on public.follows;
create policy "Follows are public" on public.follows for select using (true);
drop policy if exists "Users follow as themselves" on public.follows;
create policy "Users follow as themselves" on public.follows for insert with check (auth.uid() = follower_id);
drop policy if exists "Users unfollow as themselves" on public.follows;
create policy "Users unfollow as themselves" on public.follows for delete using (auth.uid() = follower_id);

-- ============================================================
--  Avatar storage bucket + policies
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
drop policy if exists "Avatar images are public" on storage.objects;
create policy "Avatar images are public" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "Users upload own avatar" on storage.objects;
create policy "Users upload own avatar" on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users update own avatar" on storage.objects;
create policy "Users update own avatar" on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own avatar" on storage.objects;
create policy "Users delete own avatar" on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
