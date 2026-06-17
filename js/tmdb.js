import { CONFIG } from "./config.js";

const BASE = "https://api.themoviedb.org/3";
export const IMG = "https://image.tmdb.org/t/p/w500";
export const IMG_BACKDROP = "https://image.tmdb.org/t/p/w1280";
export const IMG_PROFILE = "https://image.tmdb.org/t/p/w185";
export const IMG_LOGO = "https://image.tmdb.org/t/p/w92";

async function tmdb(path, params = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", CONFIG.TMDB_API_KEY);
  url.searchParams.set("include_adult", "false");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.status_message || `TMDB error ${res.status}`);
  }
  return res.json();
}

export function getPopular(page = 1) {
  return tmdb("/movie/popular", { page });
}

export function getPopularTV(page = 1) {
  return tmdb("/tv/popular", { page });
}

export function searchMovies(query, page = 1) {
  return tmdb("/search/movie", { query, page });
}

// Searches movies AND tv (and people, which we filter out in the app).
export function searchMulti(query, page = 1) {
  return tmdb("/search/multi", { query, page });
}

export function getMovie(id) {
  return tmdb(`/movie/${id}`, { append_to_response: "credits,videos,recommendations,watch/providers" });
}

export function getTV(id) {
  return tmdb(`/tv/${id}`, { append_to_response: "credits,videos,recommendations,watch/providers" });
}

export function getSeason(tvId, seasonNumber) {
  return tmdb(`/tv/${tvId}/season/${seasonNumber}`);
}

// "More like this" — same media type as the parent.
export function recommendations(type, id) {
  return tmdb(`/${type}/${id}/recommendations`);
}

// Streaming providers for a region from an appended watch/providers object.
export function watchProviders(detail, region = "US") {
  const all = detail["watch/providers"]?.results || {};
  const r = all[region] || all[Object.keys(all)[0]] || {};
  const seen = new Set();
  return (r.flatrate || r.free || r.ads || [])
    .filter((p) => !seen.has(p.provider_id) && seen.add(p.provider_id))
    .slice(0, 6);
}

// A browse section for movies or tv: popular | top_rated | new
const LIST_PATHS = {
  movie: { popular: "/movie/popular", top_rated: "/movie/top_rated", new: "/movie/now_playing" },
  tv: { popular: "/tv/popular", top_rated: "/tv/top_rated", new: "/tv/on_the_air" },
};
export function getList(type, category, page = 1) {
  return tmdb(LIST_PATHS[type][category] || LIST_PATHS[type].popular, { page });
}

export function getGenres(type) {
  return tmdb(`/genre/${type}/list`);
}

// Filter by genre (and order to match the chosen category).
export function discover(type, { genreId, category = "popular", page = 1 }) {
  const sort =
    category === "top_rated"
      ? "vote_average.desc"
      : category === "new"
        ? type === "movie"
          ? "primary_release_date.desc"
          : "first_air_date.desc"
        : "popularity.desc";
  const params = { with_genres: genreId, sort_by: sort, page };
  if (category === "top_rated") params["vote_count.gte"] = 200;
  return tmdb(`/discover/${type}`, params);
}

// First YouTube trailer key from an appended videos object.
export function trailerKey(videos) {
  const list = videos?.results || [];
  const v =
    list.find((x) => x.site === "YouTube" && x.type === "Trailer") ||
    list.find((x) => x.site === "YouTube" && x.type === "Teaser") ||
    list.find((x) => x.site === "YouTube");
  return v?.key || null;
}

// Unify movie & tv objects to a common shape (title / release_date / media_type).
export function normalizeItem(it, forceType) {
  const media_type = forceType || it.media_type || "movie";
  return {
    ...it,
    media_type,
    title: it.title || it.name || "Untitled",
    release_date: it.release_date || it.first_air_date || "",
  };
}

export const year = (date) => (date ? String(date).slice(0, 4) : "");
