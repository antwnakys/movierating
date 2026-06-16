// ============================================================
//  CONFIG — fill these in before the site will work.
//  All three values are PUBLIC client-side keys (safe to commit):
//    • Supabase anon key is protected by Row Level Security.
//    • TMDB key is a read-only client key.
//  See README.md for step-by-step setup.
// ============================================================

export const CONFIG = {
  // 1) Supabase → Project Settings → API
  SUPABASE_URL: "YOUR_SUPABASE_URL",          // e.g. https://abcd1234.supabase.co
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",

  // 2) TMDB → Settings → API → API Read Access / API Key (v3 auth)
  TMDB_API_KEY: "YOUR_TMDB_API_KEY",
};
