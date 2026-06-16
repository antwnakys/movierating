-- ============================================================
--  CineRate migration #4 — movie recommendations
--  Run ONCE in Supabase → SQL Editor. Safe to re-run.
--  Lets a user recommend a movie to people they're connected to.
-- ============================================================

create table if not exists public.recommendations (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references auth.users(id) on delete cascade,
  from_name    text,
  to_user      uuid not null references auth.users(id) on delete cascade,
  movie_id     bigint not null,
  movie_title  text not null,
  movie_poster text,
  movie_year   text,
  note         text,
  created_at   timestamptz not null default now(),
  unique (from_user, to_user, movie_id),
  check (from_user <> to_user)
);

create index if not exists recommendations_to_idx on public.recommendations (to_user);

alter table public.recommendations enable row level security;

-- You can see recommendations sent TO you or BY you.
drop policy if exists "See own recommendations" on public.recommendations;
create policy "See own recommendations"
  on public.recommendations for select
  using (auth.uid() = to_user or auth.uid() = from_user);

-- You can only send as yourself.
drop policy if exists "Send recommendations" on public.recommendations;
create policy "Send recommendations"
  on public.recommendations for insert
  with check (auth.uid() = from_user);

-- Sender or recipient can remove it.
drop policy if exists "Remove recommendations" on public.recommendations;
create policy "Remove recommendations"
  on public.recommendations for delete
  using (auth.uid() = to_user or auth.uid() = from_user);
