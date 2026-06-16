import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CONFIG } from "./config.js";

// Only build the client once a real URL is configured. With the placeholder
// value createClient() throws ("Invalid supabaseUrl"), so we guard it and let
// app.js show the friendly setup message instead of crashing on load.
const hasValidUrl = /^https?:\/\/.+/.test(CONFIG.SUPABASE_URL);
export const supabase = hasValidUrl
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
  : null;

// ---- Auth ----
export function signUp(email, password, displayName) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
}

export function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signOut() {
  return supabase.auth.signOut();
}

export function onAuth(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function currentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// ---- Ratings ----

// Insert or update the signed-in user's rating for a movie.
// `mode` is "simple" or "detailed"; in detailed mode `aspects` holds the five
// per-aspect scores and `rating` is their average.
export async function upsertRating({ movie, rating, mode = "simple", aspects = null, review, user }) {
  const row = {
    user_id: user.id,
    user_name: user.user_metadata?.display_name || user.email.split("@")[0],
    movie_id: movie.id,
    movie_title: movie.title,
    movie_poster: movie.poster_path || null,
    movie_year: (movie.release_date || "").slice(0, 4) || null,
    rating,
    mode,
    rating_movie: aspects?.movie ?? null,
    rating_directing: aspects?.directing ?? null,
    rating_acting: aspects?.acting ?? null,
    rating_music: aspects?.music ?? null,
    rating_scenario: aspects?.scenario ?? null,
    review: review?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  return supabase.from("ratings").upsert(row, { onConflict: "user_id,movie_id" });
}

export async function deleteRating(userId, movieId) {
  return supabase.from("ratings").delete().eq("user_id", userId).eq("movie_id", movieId);
}

// All ratings for one movie (for community average + review list).
export async function getMovieRatings(movieId) {
  const { data, error } = await supabase
    .from("ratings")
    .select("*")
    .eq("movie_id", movieId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// The signed-in user's own ratings (also serves as their personal activity).
export async function getUserRatings(userId) {
  const { data, error } = await supabase
    .from("ratings")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Global activity feed: the most recent ratings from everyone.
export async function getRecentActivity(limit = 40) {
  const { data, error } = await supabase
    .from("ratings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ---- Watchlist ----

export async function addToWatchlist({ movie, user }) {
  const row = {
    user_id: user.id,
    movie_id: movie.id,
    movie_title: movie.title,
    movie_poster: movie.poster_path || null,
    movie_year: (movie.release_date || "").slice(0, 4) || null,
  };
  // upsert so re-adding never errors on the unique constraint
  return supabase.from("watchlist").upsert(row, { onConflict: "user_id,movie_id" });
}

export async function removeFromWatchlist(userId, movieId) {
  return supabase.from("watchlist").delete().eq("user_id", userId).eq("movie_id", movieId);
}

export async function getWatchlist(userId) {
  const { data, error } = await supabase
    .from("watchlist")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
