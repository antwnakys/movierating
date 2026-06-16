# 🎬 CineRate

A movie-rating site where **anyone can sign up, sign in, and rate any movie ever made.**
Search the entire [TMDB](https://www.themoviedb.org/) catalog, give a movie 1–5 stars,
write a review, and see the community's average score — all shared across every user in real time.

- **Frontend:** plain HTML/CSS/JS (no build step) → deploys to **GitHub Pages**
- **Auth + database:** [Supabase](https://supabase.com) (real shared accounts & ratings)
- **Movie data:** [TMDB API](https://developer.themoviedb.org) (millions of movies, live)

---

## ⚡ Setup (about 10 minutes)

You need three free keys. All three are **public client-side keys** and safe to commit.

### 1. Get a TMDB API key
1. Create a free account at <https://www.themoviedb.org/signup>.
2. Go to **Settings → API** → request an **API Key (Developer)**.
3. Copy the **API Key (v3 auth)** value.

### 2. Create a Supabase project
1. Sign up at <https://supabase.com> and create a new project (free tier is fine).
2. Open the **SQL Editor → New query**, paste the contents of
   [`supabase-schema.sql`](supabase-schema.sql), and click **Run**.
3. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon / public** key
4. *(Optional, recommended for testing)* Under **Authentication → Providers → Email**,
   turn **off** "Confirm email" so new accounts work instantly without email confirmation.

### 3. Add your keys
Open [`js/config.js`](js/config.js) and replace the three placeholders:

```js
export const CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
  TMDB_API_KEY: "your_tmdb_v3_key",
};
```

### 4. Run it
Because it uses ES modules, open it through a local server (not `file://`):

```bash
# from the project folder
python3 -m http.server 8000
# then visit http://localhost:8000
```

---

## 🚀 Deploy to GitHub Pages

1. Push this folder to your GitHub repo (e.g. `movierating`).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick branch **`main`** and folder **`/ (root)`**, then **Save**.
4. After a minute your site is live at:
   `https://<your-username>.github.io/movierating/`

Anyone with that link can sign up and start rating. 🎉

> ### ⚠️ A note on the Supabase anon key
> The anon key is **designed to be public** — it's exposed in every Supabase web app.
> Your data is protected by the **Row Level Security** policies in `supabase-schema.sql`:
> anyone can *read* ratings (for averages), but users can only *edit/delete their own*.
> The TMDB v3 key is likewise a read-only client key. So committing `config.js` is expected and safe.

---

## 🗂 Project structure

```
index.html            # markup: auth gate, movie grid, detail modal
css/styles.css        # dark "cinema" theme
js/config.js          # ← your 3 keys go here
js/tmdb.js            # TMDB API calls (popular / search / details)
js/db.js              # Supabase auth + ratings CRUD
js/app.js             # all UI logic
supabase-schema.sql   # full database schema + RLS (fresh installs)
supabase-migration.sql# upgrade an existing DB: half-stars + watchlist
```

## ✨ Features
- Email/password **sign up & sign in** (whole app is gated behind auth)
- Search **any** movie or browse what's popular
- **Half-star precision** — rate from 0.5 to 5.0 in 0.5 steps (e.g. 3.5)
- **Two rating modes:** *Simple* (one score) or *Detailed* — rate **Movie, Directing,
  Acting, Music & Scenario** separately and the average becomes your score
- **Activity feed** — a global *Everyone* feed plus your personal *You* feed
- Optional written **reviews** + a community **per-aspect breakdown**
- **Watchlist** — save movies to watch later (private to each user)
- **Community average** computed from all users, alongside the TMDB score
- **"My ratings"** and **"Watchlist"** views
- Update or remove your rating any time

## 🔄 Already deployed? Run the migrations
Run these once each in **Supabase → SQL Editor** (safe to re-run), in order:
1. [`supabase-migration.sql`](supabase-migration.sql) — half-star ratings + `watchlist` table
2. [`supabase-migration-2.sql`](supabase-migration-2.sql) — detailed (multi-aspect) ratings

Fresh installs using [`supabase-schema.sql`](supabase-schema.sql) already include everything.
