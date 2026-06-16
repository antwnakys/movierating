import { CONFIG } from "./config.js";

const BASE = "https://api.themoviedb.org/3";
export const IMG = "https://image.tmdb.org/t/p/w500";
export const IMG_BACKDROP = "https://image.tmdb.org/t/p/w1280";

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

export function searchMovies(query, page = 1) {
  return tmdb("/search/movie", { query, page });
}

export function getMovie(id) {
  return tmdb(`/movie/${id}`, { append_to_response: "credits" });
}

export const year = (date) => (date ? String(date).slice(0, 4) : "");
