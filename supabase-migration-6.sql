-- ============================================================
--  CineRate migration #6 — custom lists
--  Run ONCE in Supabase → SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  user_name   text,
  title       text not null,
  description text,
  is_public   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists lists_user_idx on public.lists (user_id);

create table if not exists public.list_items (
  id           uuid primary key default gen_random_uuid(),
  list_id      uuid not null references public.lists(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  movie_id     bigint not null,
  movie_title  text not null,
  movie_poster text,
  movie_year   text,
  created_at   timestamptz not null default now(),
  unique (list_id, movie_id)
);
create index if not exists list_items_list_idx on public.list_items (list_id);

alter table public.lists enable row level security;
alter table public.list_items enable row level security;

-- Lists: public ones are visible to all; you always see your own.
drop policy if exists "Lists visible" on public.lists;
create policy "Lists visible" on public.lists for select
  using (is_public or auth.uid() = user_id);
drop policy if exists "Lists insert own" on public.lists;
create policy "Lists insert own" on public.lists for insert with check (auth.uid() = user_id);
drop policy if exists "Lists update own" on public.lists;
create policy "Lists update own" on public.lists for update using (auth.uid() = user_id);
drop policy if exists "Lists delete own" on public.lists;
create policy "Lists delete own" on public.lists for delete using (auth.uid() = user_id);

-- List items: visible if you own them or their list is public.
drop policy if exists "List items visible" on public.list_items;
create policy "List items visible" on public.list_items for select
  using (
    auth.uid() = user_id
    or exists (select 1 from public.lists l where l.id = list_items.list_id and l.is_public)
  );
drop policy if exists "List items insert own" on public.list_items;
create policy "List items insert own" on public.list_items for insert with check (auth.uid() = user_id);
drop policy if exists "List items delete own" on public.list_items;
create policy "List items delete own" on public.list_items for delete using (auth.uid() = user_id);
