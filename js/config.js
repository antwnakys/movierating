// ============================================================
//  CONFIG — fill these in before the site will work.
//  All three values are PUBLIC client-side keys (safe to commit):
//    • Supabase anon key is protected by Row Level Security.
//    • TMDB key is a read-only client key.
//  See README.md for step-by-step setup.
// ============================================================

export const CONFIG = {
  // 1) Supabase → Project Settings → API
  SUPABASE_URL: "https://ejvqeqodnlojzgpyorqg.supabase.co",          // e.g. https://abcd1234.supabase.co
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdnFlcW9kbmxvanpncHlvcnFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MDY3NzgsImV4cCI6MjA5NzE4Mjc3OH0.M8gAzYSePE58SEc4XjnfpyYh3ohGdLii7LKFb20FfI4",

  // 2) TMDB → Settings → API → API Read Access / API Key (v3 auth)
  TMDB_API_KEY: "e5bd27a04e37be4498409fc3e4f8f77b",
};
