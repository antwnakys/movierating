import { CONFIG } from "./config.js";

const BASE = "https://api.themoviedb.org/3";
export const IMG = "https://image.tmdb.org/t/p/w500";
export const IMG_BACKDROP = "https://image.tmdb.org/t/p/w1280";
export const IMG_PROFILE = "https://image.tmdb.org/t/p/w185";

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
  return tmdb(`/movie/${id}`, { append_to_response: "credits" });
}

export function getTV(id) {
  return tmdb(`/tv/${id}`, { append_to_response: "credits" });
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
