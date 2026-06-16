-- ============================================================
--  CineRate migration #5 — liked movies
--  Run ONCE in Supabase → SQL Editor. Safe to re-run.
--  Likes are public so they can show on a user's profile.
-- ============================================================

create table if not exists public.likes (
  user_id      uuid not null references auth.users(id) on delete cascade,
  movie_id     bigint not null,
  movie_title  text not null,
  movie_poster text,
  movie_year   text,
  created_at   timestamptz not null default now(),
  primary key (user_id, movie_id)
);

create index if not exists likes_user_idx on public.likes (user_id);

alter table public.likes enable row level security;

drop policy if exists "Likes are public" on public.likes;
create policy "Likes are public" on public.likes for select using (true);

drop policy if exists "Users like as themselves" on public.likes;
create policy "Users like as themselves" on public.likes for insert with check (auth.uid() = user_id);

drop policy if exists "Users unlike as themselves" on public.likes;
create policy "Users unlike as themselves" on public.likes for delete using (auth.uid() = user_id);
