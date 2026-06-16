-- ============================================================
--  CineRate migration #2 — detailed (multi-aspect) ratings
--  Run ONCE in Supabase → SQL Editor. Safe to re-run.
--  Adds a per-aspect rating system (movie / directing / acting /
--  music / scenario). The overall `rating` column now holds either
--  the simple rating or the average of the 5 aspects.
-- ============================================================

-- The detailed average can be a single-decimal value like 4.2, so the
-- overall rating no longer needs to be a half-step — just within range.
alter table public.ratings drop constraint if exists ratings_rating_check;
alter table public.ratings
  add constraint ratings_rating_check check (rating >= 0.5 and rating <= 5);

-- 'simple' = one rating, 'detailed' = the 5 aspects
alter table public.ratings add column if not exists mode text not null default 'simple';
alter table public.ratings drop constraint if exists ratings_mode_check;
alter table public.ratings
  add constraint ratings_mode_check check (mode in ('simple', 'detailed'));

-- Per-aspect scores (nullable; only used in detailed mode)
alter table public.ratings add column if not exists rating_movie     numeric(2,1);
alter table public.ratings add column if not exists rating_directing numeric(2,1);
alter table public.ratings add column if not exists rating_acting    numeric(2,1);
alter table public.ratings add column if not exists rating_music     numeric(2,1);
alter table public.ratings add column if not exists rating_scenario  numeric(2,1);

-- Each aspect must be null or a valid half-step value 0.5 .. 5.0
alter table public.ratings drop constraint if exists ratings_aspects_valid;
alter table public.ratings add constraint ratings_aspects_valid check (
  (rating_movie     is null or (rating_movie     between 0.5 and 5 and (rating_movie     * 2) = floor(rating_movie     * 2))) and
  (rating_directing is null or (rating_directing between 0.5 and 5 and (rating_directing * 2) = floor(rating_directing * 2))) and
  (rating_acting    is null or (rating_acting    between 0.5 and 5 and (rating_acting    * 2) = floor(rating_acting    * 2))) and
  (rating_music     is null or (rating_music     between 0.5 and 5 and (rating_music     * 2) = floor(rating_music     * 2))) and
  (rating_scenario  is null or (rating_scenario  between 0.5 and 5 and (rating_scenario  * 2) = floor(rating_scenario  * 2)))
);

-- Detailed mode requires all five aspects to be present
alter table public.ratings drop constraint if exists ratings_detailed_complete;
alter table public.ratings add constraint ratings_detailed_complete check (
  mode = 'simple' or (
    rating_movie is not null and rating_directing is not null and rating_acting is not null
    and rating_music is not null and rating_scenario is not null
  )
);
