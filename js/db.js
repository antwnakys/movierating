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

// A page of one user's ratings (their "watched" list). 0-indexed.
export async function getUserRatingsPage(userId, from = 0, size = 18) {
  const { data, error } = await supabase
    .from("ratings")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .range(from, from + size - 1);
  if (error) throw error;
  return data || [];
}

// ---- Profiles ----

// Create the profile row on first sign-in (won't overwrite an existing one).
export async function ensureProfile(user) {
  return supabase.from("profiles").upsert(
    { id: user.id, display_name: user.user_metadata?.display_name || user.email.split("@")[0] },
    { onConflict: "id", ignoreDuplicates: true }
  );
}

export async function getProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, fields) {
  return supabase
    .from("profiles")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", userId);
}

// Upload an avatar image and return its public URL.
export async function uploadAvatar(userId, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${userId}/avatar_${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
}

// ---- Follows ----

export async function follow(followerId, followingId) {
  return supabase.from("follows").insert({ follower_id: followerId, following_id: followingId });
}

export async function unfollow(followerId, followingId) {
  return supabase
    .from("follows")
    .delete()
    .eq("follower_id", followerId)
    .eq("following_id", followingId);
}

export async function isFollowing(followerId, followingId) {
  const { count } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("follower_id", followerId)
    .eq("following_id", followingId);
  return (count || 0) > 0;
}

export async function getFollowCounts(userId) {
  const followers = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("following_id", userId);
  const following = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("follower_id", userId);
  return { followers: followers.count || 0, following: following.count || 0 };
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
