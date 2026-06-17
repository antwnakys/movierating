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

// Recent ratings from a set of users (the "Following" activity feed).
export async function getFollowingActivity(userIds, limit = 40) {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from("ratings")
    .select("*")
    .in("user_id", userIds)
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

// ---- Likes ----

export async function likeMovie({ movie, user }) {
  return supabase.from("likes").upsert(
    {
      user_id: user.id,
      movie_id: movie.id,
      movie_title: movie.title,
      movie_poster: movie.poster_path || null,
      movie_year: (movie.release_date || "").slice(0, 4) || null,
    },
    { onConflict: "user_id,movie_id" }
  );
}

export async function unlikeMovie(userId, movieId) {
  return supabase.from("likes").delete().eq("user_id", userId).eq("movie_id", movieId);
}

export async function getLikes(userId) {
  const { data, error } = await supabase
    .from("likes")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getLikedIds(userId) {
  const { data, error } = await supabase.from("likes").select("movie_id").eq("user_id", userId);
  if (error) throw error;
  return (data || []).map((r) => r.movie_id);
}

// Total likes for one movie (across all users).
export async function getMovieLikeCount(movieId) {
  const { count, error } = await supabase
    .from("likes")
    .select("*", { count: "exact", head: true })
    .eq("movie_id", movieId);
  if (error) throw error;
  return count || 0;
}

// Map of movie_id -> like count for a batch of movies (one query).
export async function getLikeCounts(movieIds) {
  if (!movieIds.length) return {};
  const { data, error } = await supabase.from("likes").select("movie_id").in("movie_id", movieIds);
  if (error) throw error;
  const map = {};
  (data || []).forEach((r) => (map[r.movie_id] = (map[r.movie_id] || 0) + 1));
  return map;
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

// Search users by display name (for the search bar).
export async function searchProfiles(query, limit = 12) {
  const term = query.replace(/[%_]/g, "\\$&"); // escape ilike wildcards
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .ilike("display_name", `%${term}%`)
    .limit(limit);
  if (error) throw error;
  return data || [];
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

// Profiles of everyone who follows `userId`.
export async function getFollowers(userId) {
  const { data, error } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("following_id", userId);
  if (error) throw error;
  return profilesByIds((data || []).map((r) => r.follower_id));
}

// Profiles of everyone `userId` follows.
export async function getFollowing(userId) {
  const { data, error } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId);
  if (error) throw error;
  return profilesByIds((data || []).map((r) => r.following_id));
}

async function profilesByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);
  if (error) throw error;
  return data || [];
}

// Map of userId -> follower count, for a set of users (one query).
export async function getFollowerCounts(ids) {
  if (!ids.length) return {};
  const { data, error } = await supabase.from("follows").select("following_id").in("following_id", ids);
  if (error) throw error;
  const map = {};
  (data || []).forEach((r) => (map[r.following_id] = (map[r.following_id] || 0) + 1));
  return map;
}

// Just the ids this user follows (for quick "am I following?" checks).
export async function getFollowingIds(userId) {
  const { data, error } = await supabase.from("follows").select("following_id").eq("follower_id", userId);
  if (error) throw error;
  return (data || []).map((r) => r.following_id);
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

// ---- Recommendations ----

export async function recommendMovie({ from, to, movie, note }) {
  return supabase.from("recommendations").upsert(
    {
      from_user: from.id,
      from_name: from.user_metadata?.display_name || from.email.split("@")[0],
      to_user: to,
      movie_id: movie.id,
      movie_title: movie.title,
      movie_poster: movie.poster_path || null,
      movie_year: (movie.release_date || "").slice(0, 4) || null,
      note: note?.trim() || null,
      created_at: new Date().toISOString(),
    },
    { onConflict: "from_user,to_user,movie_id" }
  );
}

export async function getIncomingRecommendations(userId) {
  const { data, error } = await supabase
    .from("recommendations")
    .select("*")
    .eq("to_user", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function dismissRecommendation(id) {
  return supabase.from("recommendations").delete().eq("id", id);
}

// ---- Custom lists ----

export async function createList({ user, title, description, isPublic }) {
  const { data, error } = await supabase
    .from("lists")
    .insert({
      user_id: user.id,
      user_name: user.user_metadata?.display_name || user.email.split("@")[0],
      title: title.trim(),
      description: description?.trim() || null,
      is_public: isPublic !== false,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getUserLists(userId) {
  const { data, error } = await supabase
    .from("lists")
    .select("*, list_items(count)")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getList(listId) {
  const { data, error } = await supabase.from("lists").select("*").eq("id", listId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getListItems(listId) {
  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .eq("list_id", listId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addToList({ listId, movie, user }) {
  await supabase.from("lists").update({ updated_at: new Date().toISOString() }).eq("id", listId);
  return supabase.from("list_items").upsert(
    {
      list_id: listId,
      user_id: user.id,
      movie_id: movie.id,
      movie_title: movie.title,
      movie_poster: movie.poster_path || null,
      movie_year: (movie.release_date || "").slice(0, 4) || null,
    },
    { onConflict: "list_id,movie_id" }
  );
}

export async function removeFromList(listId, movieId) {
  return supabase.from("list_items").delete().eq("list_id", listId).eq("movie_id", movieId);
}

export async function deleteList(listId) {
  return supabase.from("lists").delete().eq("id", listId);
}

// Which of the user's lists already contain a given movie id.
export async function getListsContaining(userId, movieId) {
  const { data, error } = await supabase
    .from("list_items")
    .select("list_id")
    .eq("user_id", userId)
    .eq("movie_id", movieId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.list_id));
}

// Count incoming recommendations newer than `since` (ISO string or null).
export async function countNewRecommendations(userId, since) {
  let q = supabase
    .from("recommendations")
    .select("*", { count: "exact", head: true })
    .eq("to_user", userId);
  if (since) q = q.gt("created_at", since);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
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
