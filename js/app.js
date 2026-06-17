import { CONFIG } from "./config.js";
import * as DB from "./db.js";
import * as TMDB from "./tmdb.js";

// ---------- element helpers ----------
const $ = (sel) => document.querySelector(sel);
const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const state = {
  user: null,
  mode: "popular", // popular | search | mine | watch | activity | profile
  browseType: "movie", // movie | tv (for the Popular browse toggle)
  category: "popular", // popular | top_rated | new
  genreId: "", // "" = all genres
  genres: { movie: [], tv: [] }, // cached genre lists
  query: "",
  page: 1,
  totalPages: 1,
  loading: false,
  watchlistIds: new Set(),
  myProfile: null,
  topMovieIds: new Set(),
  likedIds: new Set(),
};

// The five aspects of a detailed rating: [key, label, db column]
const ASPECTS = [
  ["movie", "Movie", "rating_movie"],
  ["directing", "Directing", "rating_directing"],
  ["acting", "Acting", "rating_acting"],
  ["music", "Music", "rating_music"],
  ["scenario", "Scenario", "rating_scenario"],
];
const emptyAspects = () => ({ movie: 0, directing: 0, acting: 0, music: 0, scenario: 0 });
const num = (v) => (v == null ? 0 : Number(v));

// --- Media-type ID namespacing ---------------------------------------------
// We store movies & series in the same `movie_id` columns. To avoid collisions
// (TMDB movie 550 ≠ tv 550) we offset TV ids into a separate range. This keeps
// the whole feature in the frontend — no schema changes.
const TV_OFFSET = 1_000_000_000; // 1e9
const SEASON_OFFSET = 3_000_000_000_000; // 3e12 — whole-season ratings
const EPISODE_OFFSET = 5_000_000_000_000; // 5e12 — episodes live above everything
const encodeId = (id, mt) => (mt === "tv" ? Number(id) + TV_OFFSET : Number(id));
// A whole season → 3e12 + tvId*1e3 + season.
const encodeSeason = (tvId, season) => SEASON_OFFSET + Number(tvId) * 1_000 + Number(season);
// One episode → 5e12 + tvId*1e6 + season*1e3 + episode.
const encodeEpisode = (tvId, season, ep) =>
  EPISODE_OFFSET + Number(tvId) * 1_000_000 + Number(season) * 1_000 + Number(ep);
const decodeType = (sid) =>
  Number(sid) >= EPISODE_OFFSET
    ? "episode"
    : Number(sid) >= SEASON_OFFSET
      ? "season"
      : Number(sid) >= TV_OFFSET
        ? "tv"
        : "movie";
// Real TMDB id to open: for a season/episode this is its parent series id.
const decodeRealId = (sid) => {
  sid = Number(sid);
  if (sid >= EPISODE_OFFSET) return Math.floor((sid - EPISODE_OFFSET) / 1_000_000);
  if (sid >= SEASON_OFFSET) return Math.floor((sid - SEASON_OFFSET) / 1_000);
  if (sid >= TV_OFFSET) return sid - TV_OFFSET;
  return sid;
};
// A DB-storable record (encoded id + display fields) from a TMDB item.
const storable = (m, mt) => ({
  id: encodeId(m.id, mt),
  title: m.title || m.name,
  poster_path: m.poster_path ?? null,
  release_date: m.release_date || m.first_air_date || "",
});
// Build a uniform card/open model from a stored DB row (movie_id is encoded).
const cardFromRow = (r) => {
  const kind = decodeType(r.movie_id);
  return {
    id: decodeRealId(r.movie_id),
    // season/episode cards open the parent series
    media_type: kind === "episode" || kind === "season" ? "tv" : kind,
    title: r.movie_title,
    poster_path: r.movie_poster,
    release_date: r.movie_year || "",
    vote_average: null,
  };
};

// =====================================================
//  LAYOUT — responsive: sidebar desktop / mobile column
// =====================================================
function applyDeviceMode() {
  const mobile = window.innerWidth <= 820;
  document.body.classList.toggle("device-mobile", mobile);
  document.body.classList.toggle("device-desktop", !mobile);
}

function setupDevice() {
  applyDeviceMode();
  window.addEventListener("resize", applyDeviceMode);
  $("#deviceScreen")?.remove(); // no device-choice screen
  $("#viewToggle")?.remove(); // layout follows screen width

  // Hamburger menu
  $("#navToggle").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#navMenu").classList.toggle("open");
  });
  $("#navMenu").addEventListener("click", (e) => {
    if (e.target.closest(".btn")) $("#navMenu").classList.remove("open");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".user-menu") && !e.target.closest(".nav-toggle")) {
      $("#navMenu").classList.remove("open");
    }
    if (!e.target.closest("#notifMenu") && !e.target.closest("#notifBtn")) {
      $("#notifMenu").classList.add("hidden");
    }
  });
}

// =====================================================
//  CONFIG CHECK
// =====================================================
function configIncomplete() {
  return (
    CONFIG.SUPABASE_URL.startsWith("YOUR_") ||
    CONFIG.SUPABASE_ANON_KEY.startsWith("YOUR_") ||
    CONFIG.TMDB_API_KEY.startsWith("YOUR_")
  );
}

// =====================================================
//  AUTH UI
// =====================================================
function setupAuthUI() {
  // Tab switching
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const isSignup = tab.dataset.tab === "signup";
      $("#signupForm").classList.toggle("hidden", !isSignup);
      $("#signinForm").classList.toggle("hidden", isSignup);
      setAuthMsg("");
    });
  });

  $("#signinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    setAuthMsg("Signing in…");
    const { error } = await DB.signIn($("#signinEmail").value, $("#signinPassword").value);
    if (error) setAuthMsg(error.message, "error");
  });

  $("#signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    setAuthMsg("Creating account…");
    const { data, error } = await DB.signUp(
      $("#signupEmail").value,
      $("#signupPassword").value,
      $("#signupName").value
    );
    if (error) return setAuthMsg(error.message, "error");
    if (data.session) return; // auto signed-in; onAuth fires
    setAuthMsg("Account created! Check your email to confirm, then sign in.", "ok");
  });

  $("#signOutBtn").addEventListener("click", () => DB.signOut());
  $("#profileBtn").addEventListener("click", () => openProfile(state.user.id));
  $("#accountBtn").addEventListener("click", () => openProfile(state.user.id));
  $("#notifBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    openNotifMenu();
  });
  $("#avatarInput").addEventListener("change", onAvatarPicked);
  $("#forYouBtn").addEventListener("click", () => loadForYou());
  $("#activityBtn").addEventListener("click", () => loadActivity("all"));
  $("#watchlistBtn").addEventListener("click", () => loadWatchlist());
  $("#listsBtn").addEventListener("click", () => loadMyLists());
  $("#myRatingsBtn").addEventListener("click", () => loadMine());
  $("#statsBtn").addEventListener("click", () => loadStats());
  $("#brandHome").addEventListener("click", (e) => {
    e.preventDefault();
    $("#searchInput").value = "";
    loadPopular();
  });
}

function setAuthMsg(msg, kind = "") {
  const node = $("#authMsg");
  node.textContent = msg;
  node.className = "auth-msg " + kind;
}

// =====================================================
//  AUTH STATE → SCREEN SWITCH
// =====================================================
function showAuthScreen() {
  $("#authScreen").classList.remove("hidden");
  $("#topbar").classList.add("hidden");
  $("#app").classList.add("hidden");
}

function showApp() {
  $("#authScreen").classList.add("hidden");
  $("#topbar").classList.remove("hidden");
  $("#app").classList.remove("hidden");
  const name = state.user.user_metadata?.display_name || state.user.email;
  $("#userName").textContent = "Hi, " + name;
}

// =====================================================
//  MOVIE GRID
// =====================================================
function movieCard(m) {
  const poster = m.poster_path
    ? `<img class="poster" loading="lazy" src="${TMDB.IMG}${m.poster_path}" alt="${esc(m.title)}" />`
    : `<div class="poster placeholder">${esc(m.title)}</div>`;
  const mt = m.media_type || "movie";
  const saved = state.watchlistIds.has(encodeId(m.id, mt));
  const rating = m.vote_average ? m.vote_average.toFixed(1) : "–";
  const card = el(`
    <div class="card" data-mid="${m.id}" data-mt="${mt}">
      <div class="poster-wrap">
        ${poster}
        <span class="media-tag ${mt}">${mt === "tv" ? "TV" : "FILM"}</span>
        <span class="like-badge hidden"><span class="heart">♥</span> <span class="lb-n"></span></span>
        <button class="card-bookmark ${saved ? "saved" : ""}" title="${saved ? "In watchlist" : "Add to watchlist"}">🔖</button>
        <div class="card-hover">
          <div class="card-hover-rating"><span class="badge-star">★ ${rating}</span></div>
          <p class="card-hover-overview">${esc(m.overview || "No synopsis available.")}</p>
          <span class="card-hover-cta">View details →</span>
        </div>
      </div>
      <div class="card-body">
        <div class="card-title">${esc(m.title)}</div>
        <div class="card-meta">
          <span>${TMDB.year(m.release_date) || "—"}</span>
          <span class="badge-star">★ ${rating}</span>
        </div>
      </div>
    </div>
  `);
  card.addEventListener("click", () => openMovie(m.id, mt));
  card.querySelector(".card-bookmark").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCardBookmark(m, mt, e.currentTarget);
  });
  return card;
}

// Toggle watchlist straight from a poster (no modal).
async function toggleCardBookmark(m, mt, btn) {
  const sid = encodeId(m.id, mt);
  const saved = state.watchlistIds.has(sid);
  btn.disabled = true;
  const { error } = saved
    ? await DB.removeFromWatchlist(state.user.id, sid)
    : await DB.addToWatchlist({ movie: storable(m, mt), user: state.user });
  btn.disabled = false;
  if (error) return;
  if (saved) state.watchlistIds.delete(sid);
  else state.watchlistIds.add(sid);
  btn.classList.toggle("saved", !saved);
  btn.title = saved ? "Add to watchlist" : "In watchlist";
  if (state.mode === "watch" && saved) btn.closest(".card")?.remove(); // dropped from watchlist view
}

function renderMovies(movies, append) {
  const grid = $("#grid");
  if (!append) grid.innerHTML = "";
  movies.forEach((m) => grid.appendChild(movieCard(m)));
  decorateLikeCounts(movies);
}

// Fill in the site-wide like count badge on freshly rendered browse cards.
async function decorateLikeCounts(movies) {
  try {
    const counts = await DB.getLikeCounts(movies.map((m) => encodeId(m.id, m.media_type || "movie")));
    movies.forEach((m) => {
      const n = counts[encodeId(m.id, m.media_type || "movie")];
      if (!n) return;
      const badge = document.querySelector(
        `#grid .card[data-mid="${m.id}"][data-mt="${m.media_type || "movie"}"] .like-badge`
      );
      if (badge) {
        badge.querySelector(".lb-n").textContent = n;
        badge.classList.remove("hidden");
      }
    });
  } catch {
    /* likes table missing — skip badges */
  }
}

const CATEGORY_LABELS = { popular: "Popular", top_rated: "Top rated", new: "New releases" };

async function loadPopular(page = 1) {
  state.mode = "popular";
  state.page = page;
  if (page === 1) clearPeople();
  setBrowseControls(true);
  const type = state.browseType;
  const typeWord = type === "tv" ? "series" : "movies";
  const genreName = state.genreId
    ? state.genres[type].find((g) => String(g.id) === String(state.genreId))?.name || ""
    : "";
  $("#sectionTitle").textContent = genreName
    ? `${genreName} ${typeWord}`
    : `${CATEGORY_LABELS[state.category]} ${typeWord}`;
  await runLoad(async () => {
    const data = state.genreId
      ? await TMDB.discover(type, { genreId: state.genreId, category: state.category, page })
      : await TMDB.getList(type, state.category, page);
    return { ...data, results: (data.results || []).map((it) => TMDB.normalizeItem(it, type)) };
  }, page === 1);
}

function setBrowseControls(visible) {
  $("#browseControls").classList.toggle("hidden", !visible);
}

async function loadGenres(type) {
  if (!state.genres[type].length) {
    try {
      state.genres[type] = (await TMDB.getGenres(type)).genres || [];
    } catch {
      state.genres[type] = [];
    }
  }
  const sel = $("#genreSelect");
  sel.innerHTML =
    '<option value="">All genres</option>' +
    state.genres[type].map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
  sel.value = state.genreId || "";
}

async function loadSearch(query, page = 1) {
  state.mode = "search";
  state.query = query;
  state.page = page;
  setBrowseControls(false);
  $("#sectionTitle").textContent = `Results for “${query}”`;
  await runLoad(async () => {
    const data = await TMDB.searchMulti(query, page);
    const results = (data.results || [])
      .filter((it) => it.media_type === "movie" || it.media_type === "tv")
      .map((it) => TMDB.normalizeItem(it));
    return { ...data, results };
  }, page === 1);
  if (page === 1) renderPeopleResults(query); // people above the results grid
}

const clearPeople = () => ($("#peopleResults").innerHTML = "");

function personCard(p) {
  const name = p.display_name || "User";
  const card = el(`
    <div class="person-card">
      ${avatarHTML(p, name)}
      <div class="person-name">${esc(name)}</div>
    </div>`);
  card.addEventListener("click", () => openProfile(p.id));
  return card;
}

async function renderPeopleResults(query) {
  const box = $("#peopleResults");
  box.innerHTML = "";
  try {
    const people = await DB.searchProfiles(query, 12);
    if (!people.length) return;
    box.innerHTML = `<h3 class="people-head">People</h3><div class="people-row"></div>`;
    const row = box.querySelector(".people-row");
    people.forEach((p) => row.appendChild(personCard(p)));
  } catch {
    /* profiles table missing or query failed — just skip people */
  }
}

async function runLoad(fetcher, reset) {
  if (state.loading) return;
  state.loading = true;
  showBrowse();
  $("#grid").classList.remove("list");
  if (reset) {
    $("#grid").innerHTML = "";
    $("#gridStatus").textContent = "Loading…";
  }
  $("#loadMore").classList.add("hidden");
  try {
    const data = await fetcher();
    state.totalPages = data.total_pages || 1;
    renderMovies(data.results || [], !reset);
    $("#gridStatus").textContent =
      (data.results || []).length === 0 ? "No movies found." : "";
    $("#loadMore").classList.toggle("hidden", state.page >= state.totalPages);
  } catch (err) {
    $("#gridStatus").textContent = "⚠️ " + err.message;
  } finally {
    state.loading = false;
  }
}

async function loadMine() {
  state.mode = "mine";
  showBrowse();
  clearPeople();
  setBrowseControls(false);
  $("#sectionTitle").textContent = "My ratings";
  $("#loadMore").classList.add("hidden");
  $("#grid").classList.remove("list");
  $("#grid").innerHTML = "";
  $("#gridStatus").textContent = "Loading…";
  try {
    const rows = await DB.getUserRatings(state.user.id);
    if (!rows.length) {
      $("#gridStatus").textContent = "You haven't rated any movies yet.";
      return;
    }
    $("#gridStatus").textContent = "";
    rows.forEach((r) => {
      const card = movieCard(cardFromRow(r));
      // Overlay the user's own star rating
      const meta = card.querySelector(".card-meta");
      meta.innerHTML = `<span>${esc(r.movie_year || "—")}</span><span class="badge-star">★ ${r.rating}/5 (you)</span>`;
      $("#grid").appendChild(card);
    });
  } catch (err) {
    $("#gridStatus").textContent = "⚠️ " + err.message;
  }
}

async function loadWatchlist() {
  state.mode = "watch";
  showBrowse();
  clearPeople();
  setBrowseControls(false);
  $("#sectionTitle").textContent = "Your watchlist";
  $("#loadMore").classList.add("hidden");
  $("#grid").classList.remove("list");
  $("#grid").innerHTML = "";
  $("#gridStatus").textContent = "Loading…";
  try {
    const rows = await DB.getWatchlist(state.user.id);
    state.watchlistIds = new Set(rows.map((r) => r.movie_id));
    if (!rows.length) {
      $("#gridStatus").textContent = 'Your watchlist is empty. Open a movie and tap "Add to watchlist".';
      return;
    }
    $("#gridStatus").textContent = "";
    rows.forEach((r) => {
      const card = movieCard(cardFromRow(r));
      card.querySelector(".card-meta").innerHTML =
        `<span>${esc(r.movie_year || "—")}</span><span class="badge-star">🔖 Saved</span>`;
      $("#grid").appendChild(card);
    });
  } catch (err) {
    $("#gridStatus").textContent = "⚠️ " + err.message;
  }
}

// Load just the movie ids on the user's watchlist (so the modal toggle
// shows the right state without opening the watchlist view).
async function refreshWatchlistIds() {
  try {
    const rows = await DB.getWatchlist(state.user.id);
    state.watchlistIds = new Set(rows.map((r) => r.movie_id));
  } catch {
    /* non-fatal */
  }
}

// =====================================================
//  FOR YOU (personalized recommendations)
// =====================================================
async function loadForYou() {
  state.mode = "foryou";
  showBrowse();
  clearPeople();
  setBrowseControls(false);
  $("#sectionTitle").textContent = "For you";
  $("#loadMore").classList.add("hidden");
  const grid = $("#grid");
  grid.classList.remove("list");
  grid.innerHTML = "";
  $("#gridStatus").textContent = "Building your picks…";
  try {
    const mine = await DB.getUserRatings(state.user.id);
    const seeds = mine.filter((r) => Number(r.rating) >= 3.5).slice(0, 8);
    if (!seeds.length) {
      $("#gridStatus").textContent =
        "Rate a few movies or shows you love (3.5★ or higher) and we'll suggest more here.";
      return;
    }
    const ratedSet = new Set(mine.map((r) => Number(r.movie_id)));
    const fetched = await Promise.all(
      seeds.map((s) => {
        const mt = decodeType(s.movie_id);
        return TMDB.recommendations(mt, decodeRealId(s.movie_id))
          .then((d) => ({ mt, results: d.results || [] }))
          .catch(() => null);
      })
    );
    const tally = new Map();
    fetched.forEach((res) => {
      if (!res) return;
      res.results.forEach((it) => {
        const norm = TMDB.normalizeItem(it, res.mt);
        const enc = encodeId(norm.id, res.mt);
        if (ratedSet.has(enc)) return;
        const cur = tally.get(enc) || { item: norm, count: 0 };
        cur.count++;
        tally.set(enc, cur);
      });
    });
    const ranked = [...tally.values()]
      .sort((a, b) => b.count - a.count || (b.item.vote_average || 0) - (a.item.vote_average || 0))
      .slice(0, 30)
      .map((x) => x.item);
    if (!ranked.length) {
      $("#gridStatus").textContent = "No suggestions yet — rate a few more titles.";
      return;
    }
    renderMovies(ranked, false);
    $("#gridStatus").textContent = "";
  } catch (err) {
    $("#gridStatus").textContent = "⚠️ " + err.message;
  }
}

// =====================================================
//  STATS ("Your taste")
// =====================================================
async function loadStats() {
  state.mode = "stats";
  showProfileView();
  const view = $("#profileView");
  view.innerHTML = `<div class="grid-status">Crunching your stats…</div>`;
  try {
    const [mine, likes, watch, counts] = await Promise.all([
      DB.getUserRatings(state.user.id),
      DB.getLikes(state.user.id).catch(() => []),
      DB.getWatchlist(state.user.id).catch(() => []),
      DB.getFollowCounts(state.user.id).catch(() => ({ followers: 0, following: 0 })),
    ]);
    renderStats(mine, likes, watch, counts);
  } catch (err) {
    view.innerHTML = `<div class="grid-status">⚠️ ${esc(err.message)}</div>`;
  }
}

function renderStats(mine, likes, watch, counts) {
  const view = $("#profileView");
  const n = mine.length;
  const avg = n ? mine.reduce((s, r) => s + Number(r.rating), 0) / n : 0;
  const movies = mine.filter((r) => decodeType(r.movie_id) === "movie").length;
  const series = n - movies;
  const dist = {};
  for (let v = 0.5; v <= 5; v += 0.5) dist[v.toFixed(1)] = 0;
  mine.forEach((r) => {
    const k = Number(r.rating).toFixed(1);
    if (dist[k] != null) dist[k]++;
  });
  const maxD = Math.max(1, ...Object.values(dist));
  const top = [...mine].sort((a, b) => Number(b.rating) - Number(a.rating)).slice(0, 5);
  const dec = {};
  mine.forEach((r) => {
    const y = parseInt(r.movie_year);
    if (y) {
      const d = Math.floor(y / 10) * 10;
      dec[d] = (dec[d] || 0) + 1;
    }
  });
  const decs = Object.entries(dec).sort((a, b) => a[0] - b[0]);

  const stat = (num, label) => `<div class="stat-card"><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>`;
  view.innerHTML = `
    <div class="stats-head"><h2>Your taste</h2></div>
    <div class="stats-cards">
      ${stat(n, "Rated")}
      ${stat(n ? avg.toFixed(2) : "–", "Avg rating")}
      ${stat(movies, "Movies")}
      ${stat(series, "Series")}
      ${stat(likes.length, "Liked")}
      ${stat(watch.length, "Watchlist")}
      ${stat(counts.followers, "Followers")}
      ${stat(counts.following, "Following")}
    </div>
    ${
      n
        ? `<div class="profile-section"><h3>Rating distribution</h3>
            <div class="dist-chart">
              ${Object.entries(dist)
                .map(
                  ([k, c]) =>
                    `<div class="dist-col" title="${c} at ${k}★"><div class="dist-bar" style="height:${Math.round((c / maxD) * 100)}%"></div><div class="dist-x">${k}</div></div>`
                )
                .join("")}
            </div>
          </div>
          <div class="profile-section"><h3>Your highest rated</h3>
            <div class="top5-row">${top.map(likeCard).join("")}</div>
          </div>
          ${
            decs.length
              ? `<div class="profile-section"><h3>By decade</h3><div class="decade-row">${decs
                  .map(([d, c]) => `<div class="decade-item"><b>${d}s</b><span>${c}</span></div>`)
                  .join("")}</div></div>`
              : ""
          }`
        : '<p class="empty" style="padding:20px 4px">Rate some movies to see your stats.</p>'
    }
  `;
  view.querySelectorAll(".top5-card").forEach((c) =>
    c.addEventListener("click", () => openMovie(Number(c.dataset.mid), c.dataset.mt))
  );
}

// =====================================================
//  CUSTOM LISTS
// =====================================================
const listCount = (l) => l.list_items?.[0]?.count ?? 0;

function listCardHTML(l) {
  return `<div class="list-card" data-id="${l.id}">
    <div class="list-card-title">${esc(l.title)} ${l.is_public ? "" : '<span class="list-private">🔒</span>'}</div>
    <div class="list-card-meta">${listCount(l)} titles${l.description ? " · " + esc(l.description) : ""}</div>
  </div>`;
}

function renderLists(lists, isSelf, heading) {
  const view = $("#profileView");
  view.innerHTML = `
    <div class="stats-head">
      <h2>${esc(heading)}</h2>
      ${isSelf ? '<button class="btn btn-primary" id="newListBtn">＋ New list</button>' : ""}
    </div>
    <div class="lists-grid">
      ${
        lists.length
          ? lists.map(listCardHTML).join("")
          : `<p class="empty">${isSelf ? "No lists yet — create one!" : "No public lists."}</p>`
      }
    </div>`;
  if (isSelf) $("#newListBtn").addEventListener("click", openCreateList);
  view.querySelectorAll(".list-card").forEach((c) =>
    c.addEventListener("click", () => openListDetail(c.dataset.id))
  );
}

async function loadMyLists() {
  state.mode = "lists";
  showProfileView();
  $("#profileView").innerHTML = `<div class="grid-status">Loading…</div>`;
  try {
    const lists = await DB.getUserLists(state.user.id);
    renderLists(lists, true, "Your lists");
  } catch (err) {
    $("#profileView").innerHTML = `<div class="grid-status">⚠️ ${esc(err.message)}</div>`;
  }
}

function openCreateList() {
  openSheet(`<div class="people-list-head"><h2>New list</h2></div>
    <div class="list-form">
      <input id="listTitle" placeholder="List title (e.g. Best heist movies)" maxlength="80" />
      <textarea id="listDesc" placeholder="Description (optional)" maxlength="200"></textarea>
      <label class="list-public"><input type="checkbox" id="listPublic" checked /> Public list</label>
      <button class="btn btn-primary" id="listCreate">Create list</button>
      <span id="listFormStatus" class="muted small"></span>
    </div>`);
  $("#listCreate").addEventListener("click", async () => {
    const title = $("#listTitle").value.trim();
    if (!title) {
      $("#listFormStatus").textContent = "Give it a title.";
      return;
    }
    try {
      await DB.createList({
        user: state.user,
        title,
        description: $("#listDesc").value,
        isPublic: $("#listPublic").checked,
      });
      closeSheet();
      loadMyLists();
    } catch (err) {
      $("#listFormStatus").textContent = "⚠️ " + err.message;
    }
  });
}

async function openListDetail(listId) {
  state.mode = "list";
  showProfileView();
  const view = $("#profileView");
  view.innerHTML = `<div class="grid-status">Loading…</div>`;
  try {
    const [list, items] = await Promise.all([DB.getList(listId), DB.getListItems(listId)]);
    if (!list) {
      view.innerHTML = `<div class="grid-status">List not found or private.</div>`;
      return;
    }
    const isOwner = list.user_id === state.user.id;
    view.innerHTML = `
      <div class="stats-head">
        <div>
          <h2>${esc(list.title)}</h2>
          <div class="muted small">by ${esc(list.user_name || "user")} · ${items.length} titles${list.is_public ? "" : " · 🔒 private"}</div>
          ${list.description ? `<p class="profile-bio">${esc(list.description)}</p>` : ""}
        </div>
        ${isOwner ? '<button class="btn btn-danger" id="deleteListBtn">Delete list</button>' : ""}
      </div>
      <div class="grid" id="listGrid"></div>
      <div class="grid-status">${items.length ? "" : 'No titles yet — open a movie and tap "＋ List".'}</div>`;
    const grid = $("#listGrid");
    items.forEach((it) => {
      const card = movieCard(cardFromRow(it));
      if (isOwner) {
        const rm = el('<button class="top5-remove" title="Remove">✕</button>');
        rm.addEventListener("click", async (e) => {
          e.stopPropagation();
          await DB.removeFromList(listId, it.movie_id);
          card.remove();
        });
        card.querySelector(".poster-wrap").appendChild(rm);
      }
      grid.appendChild(card);
    });
    if (isOwner)
      $("#deleteListBtn").addEventListener("click", async () => {
        if (!confirm("Delete this list?")) return;
        await DB.deleteList(listId);
        loadMyLists();
      });
  } catch (err) {
    view.innerHTML = `<div class="grid-status">⚠️ ${esc(err.message)}</div>`;
  }
}

// Sheet to add the current modal movie to one or more lists.
async function openListPicker() {
  const sid = modalState.storeId;
  const store = storable(modalState.movie, modalState.mediaType);
  const head = `<div class="people-list-head"><h2>Add to a list</h2></div>
    <div class="recommend-note list-create-inline">
      <input id="newListInline" placeholder="Create a new list…" maxlength="80" />
      <button class="btn btn-primary" id="newListInlineBtn">Create & add</button>
    </div>`;
  openSheet(head + `<div class="grid-status">Loading your lists…</div>`);
  const render = async () => {
    const [lists, containing] = await Promise.all([
      DB.getUserLists(state.user.id),
      DB.getListsContaining(state.user.id, sid),
    ]);
    const body = lists.length
      ? `<div class="people-list">${lists
          .map(
            (l) => `<div class="rec-row" data-id="${l.id}">
              <span class="person-row-name">${esc(l.title)} <span class="muted small">(${listCount(l)})</span></span>
              <button class="btn list-toggle ${containing.has(l.id) ? "btn-watch active" : "btn-primary"}">${containing.has(l.id) ? "✓ Added" : "Add"}</button>
            </div>`
          )
          .join("")}</div>`
      : '<p class="empty" style="padding:16px 24px">No lists yet — create one above.</p>';
    $("#sheetBody").innerHTML = head + body;
    $("#newListInlineBtn").addEventListener("click", async () => {
      const t = $("#newListInline").value.trim();
      if (!t) return;
      const list = await DB.createList({ user: state.user, title: t, isPublic: true });
      await DB.addToList({ listId: list.id, movie: store, user: state.user });
      render();
    });
    $("#sheetBody")
      .querySelectorAll(".rec-row")
      .forEach((row) =>
        row.querySelector(".list-toggle").addEventListener("click", async (e) => {
          e.currentTarget.disabled = true;
          if (e.currentTarget.classList.contains("active")) await DB.removeFromList(row.dataset.id, sid);
          else await DB.addToList({ listId: row.dataset.id, movie: store, user: state.user });
          render();
        })
      );
  };
  render();
}

// =====================================================
//  ACTIVITY FEED (global + personal)
// =====================================================
let activityScope = "all"; // "all" = everyone, "mine" = just this user

function timeAgo(iso) {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function activityItem(r, followers = 0, amFollowing = false) {
  const initials = (r.user_name || "?").slice(0, 1).toUpperCase();
  const poster = r.movie_poster
    ? `<img class="feed-poster" loading="lazy" src="${TMDB.IMG}${r.movie_poster}" alt="" />`
    : `<div class="feed-poster"></div>`;
  const isSelf = r.user_id === state.user.id;
  const followBtn = isSelf
    ? ""
    : `<button class="btn-follow ${amFollowing ? "active" : ""}" data-uid="${r.user_id}">${amFollowing ? "Following ✓" : "Follow"}</button>`;
  const item = el(`
    <div class="feed-item">
      <div class="review-avatar author-link" data-uid="${r.user_id}">${esc(initials)}</div>
      <div class="feed-body">
        <div class="feed-line"><b class="author-link" data-uid="${r.user_id}">${esc(r.user_name || "Someone")}</b> rated <b>${esc(r.movie_title)}</b>${r.movie_year ? " (" + esc(r.movie_year) + ")" : ""}</div>
        <div class="feed-meta">
          ${starsDisplay(r.rating, "sm")}
          <span class="feed-score">${Number(r.rating).toFixed(1)}</span>
          ${r.mode === "detailed" ? '<span class="feed-badge">detailed</span>' : ""}
          <span class="review-date">${timeAgo(r.updated_at)}</span>
        </div>
        ${r.review ? `<div class="feed-review">“${esc(r.review)}”</div>` : ""}
        <div class="feed-stats">
          <span class="feed-followers">${followers} follower${followers === 1 ? "" : "s"}</span>
          ${followBtn}
        </div>
      </div>
      ${poster}
    </div>
  `);
  item.addEventListener("click", () => openMovie(decodeRealId(r.movie_id), decodeType(r.movie_id)));
  item.querySelectorAll(".author-link").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.stopPropagation();
      openProfile(r.user_id);
    })
  );
  const fb = item.querySelector(".btn-follow");
  if (fb)
    fb.addEventListener("click", async (e) => {
      e.stopPropagation();
      const active = fb.classList.contains("active");
      fb.disabled = true;
      const { error } = active
        ? await DB.unfollow(state.user.id, r.user_id)
        : await DB.follow(state.user.id, r.user_id);
      fb.disabled = false;
      if (error) return;
      fb.classList.toggle("active");
      fb.textContent = active ? "Follow" : "Following ✓";
    });
  return item;
}

async function loadActivity(scope = activityScope) {
  activityScope = scope;
  state.mode = "activity";
  showBrowse();
  clearPeople();
  setBrowseControls(false);
  $("#loadMore").classList.add("hidden");
  $("#sectionTitle").innerHTML = `Activity
    <span class="scope-toggle">
      <button class="scope-btn ${scope === "all" ? "active" : ""}" data-scope="all">Everyone</button>
      <button class="scope-btn ${scope === "following" ? "active" : ""}" data-scope="following">Following</button>
      <button class="scope-btn ${scope === "mine" ? "active" : ""}" data-scope="mine">You</button>
    </span>`;
  document.querySelectorAll(".scope-btn").forEach((b) =>
    b.addEventListener("click", () => loadActivity(b.dataset.scope))
  );

  const grid = $("#grid");
  grid.classList.add("list");
  grid.innerHTML = "";
  $("#gridStatus").textContent = "Loading…";
  try {
    let rows;
    if (scope === "mine") {
      rows = await DB.getUserRatings(state.user.id);
    } else if (scope === "following") {
      const ids = await DB.getFollowingIds(state.user.id);
      rows = await DB.getFollowingActivity(ids, 40);
    } else {
      rows = await DB.getRecentActivity(40);
    }
    if (!rows.length) {
      $("#gridStatus").textContent =
        scope === "mine"
          ? "You haven't rated anything yet."
          : scope === "following"
            ? "No activity from people you follow yet — go follow some users!"
            : "No activity yet — be the first to rate a movie!";
      return;
    }
    const ids = [...new Set(rows.map((r) => r.user_id))];
    const [followerMap, myFollowing] = await Promise.all([
      DB.getFollowerCounts(ids).catch(() => ({})),
      DB.getFollowingIds(state.user.id).catch(() => []),
    ]);
    const followingSet = new Set(myFollowing);
    $("#gridStatus").textContent = "";
    rows.forEach((r) =>
      grid.appendChild(activityItem(r, followerMap[r.user_id] || 0, followingSet.has(r.user_id)))
    );
  } catch (err) {
    $("#gridStatus").textContent = "⚠️ " + err.message;
  }
}

// =====================================================
//  PROFILES + FOLLOWING
// =====================================================
function showBrowse() {
  $("#browseView").classList.remove("hidden");
  $("#profileView").classList.add("hidden");
}
function showProfileView() {
  $("#browseView").classList.add("hidden");
  $("#profileView").classList.remove("hidden");
}

// Load the signed-in user's own profile into state (for follow / top-5 actions).
async function loadMyProfileState() {
  try {
    await DB.ensureProfile(state.user);
    state.myProfile = (await DB.getProfile(state.user.id)) || { top_movies: [] };
    const top = Array.isArray(state.myProfile.top_movies) ? state.myProfile.top_movies : [];
    state.topMovieIds = new Set(top.map((x) => x.id));
  } catch {
    state.myProfile = { top_movies: [] };
  }
  updateAccountIcons();
}

function avatarHTML(profile, name, cls = "") {
  return profile?.avatar_url
    ? `<img class="avatar-img ${cls}" src="${esc(profile.avatar_url)}" alt="${esc(name)}" />`
    : `<div class="avatar-img ${cls} placeholder">${esc((name || "?").slice(0, 1).toUpperCase())}</div>`;
}

function top5Card(mv, i, isSelf) {
  const realId = decodeRealId(mv.id);
  const mt = mv.media_type || decodeType(mv.id);
  const poster = mv.poster
    ? `<img class="poster" loading="lazy" src="${TMDB.IMG}${mv.poster}" alt="${esc(mv.title)}" />`
    : `<div class="poster placeholder">${esc(mv.title)}</div>`;
  return `<div class="top5-card" data-mid="${realId}" data-mt="${mt}">
    <span class="top5-rank">${i + 1}</span>
    ${isSelf ? `<button class="top5-remove" data-id="${mv.id}" title="Remove">✕</button>` : ""}
    ${mt === "tv" ? '<span class="media-tag">TV</span>' : ""}
    ${poster}
    <div class="top5-title">${esc(mv.title)}</div>
  </div>`;
}

let watchedObserver = null;

async function openProfile(userId) {
  state.mode = "profile";
  closeModal();
  showProfileView();
  const view = $("#profileView");
  view.innerHTML = `<div class="grid-status">Loading…</div>`;
  try {
    const isSelf = userId === state.user.id;
    const [profile, counts, following, likes, lists] = await Promise.all([
      DB.getProfile(userId),
      DB.getFollowCounts(userId),
      isSelf ? Promise.resolve(false) : DB.isFollowing(state.user.id, userId),
      DB.getLikes(userId).catch(() => []),
      DB.getUserLists(userId).catch(() => []),
    ]);
    renderProfile(userId, profile, counts, following, isSelf, likes, lists);
    if (isSelf) {
      loadIncomingRecs(userId);
      markRecsSeen();
    }
  } catch (err) {
    view.innerHTML = `<div class="grid-status">⚠️ ${esc(err.message)}</div>`;
  }
}

function recCard(r) {
  const realId = decodeRealId(r.movie_id);
  const mt = decodeType(r.movie_id);
  const poster = r.movie_poster
    ? `<img class="poster" loading="lazy" src="${TMDB.IMG}${r.movie_poster}" alt="${esc(r.movie_title)}" />`
    : `<div class="poster placeholder">${esc(r.movie_title)}</div>`;
  return `<div class="rec-card" data-mid="${realId}" data-mt="${mt}" data-id="${r.id}">
    <button class="rec-dismiss" title="Dismiss">✕</button>
    ${mt === "tv" ? '<span class="media-tag">TV</span>' : ""}
    ${poster}
    <div class="rec-card-title">${esc(r.movie_title)}</div>
    <div class="rec-card-from">from ${esc(r.from_name || "someone")}</div>
    ${r.note ? `<div class="rec-card-note">“${esc(r.note)}”</div>` : ""}
  </div>`;
}

// Show a badge with the count of recommendations received since last viewed.
async function refreshRecBadge() {
  try {
    const since = localStorage.getItem("cinerate_recs_seen");
    const n = await DB.countNewRecommendations(state.user.id, since);
    const badge = $("#recBadge");
    badge.textContent = n > 9 ? "9+" : n;
    badge.classList.toggle("hidden", n === 0);
    $("#notifBtn").classList.toggle("has-badge", n > 0);
  } catch {
    /* recommendations table may not exist yet */
  }
}

function markRecsSeen() {
  localStorage.setItem("cinerate_recs_seen", new Date().toISOString());
  $("#recBadge")?.classList.add("hidden");
  $("#notifBtn")?.classList.remove("has-badge");
}

// Set the topbar avatar icon to the user's photo (or their initial).
function updateAccountIcons() {
  const av = $("#navAvatar");
  if (!av) return;
  const url = state.myProfile?.avatar_url;
  const name = state.user?.user_metadata?.display_name || state.user?.email || "?";
  if (url) {
    av.style.backgroundImage = `url("${url}")`;
    av.classList.add("has-img");
    av.textContent = "";
  } else {
    av.style.backgroundImage = "";
    av.classList.remove("has-img");
    av.textContent = name.slice(0, 1).toUpperCase();
  }
}

// Notifications dropdown (incoming recommendations).
async function openNotifMenu() {
  const menu = $("#notifMenu");
  if (!menu.classList.contains("hidden")) {
    menu.classList.add("hidden");
    return;
  }
  // Anchor the panel to the bell (works for both the sidebar item and mobile icon)
  const r = $("#notifBtn").getBoundingClientRect();
  menu.style.position = "fixed";
  if (document.body.classList.contains("device-desktop")) {
    menu.style.left = Math.round(r.right + 8) + "px";
    menu.style.top = Math.round(r.top) + "px";
    menu.style.right = "auto";
  } else {
    menu.style.left = "auto";
    menu.style.right = "10px";
    menu.style.top = Math.round(r.bottom + 6) + "px";
  }
  menu.classList.remove("hidden");
  menu.innerHTML = `<div class="notif-head">Notifications</div><div class="notif-empty">Loading…</div>`;
  try {
    const recs = await DB.getIncomingRecommendations(state.user.id);
    const body = recs.length
      ? recs
          .slice(0, 12)
          .map(
            (r) => `<div class="notif-item" data-mid="${decodeRealId(r.movie_id)}" data-mt="${decodeType(r.movie_id)}">
              <b>${esc(r.from_name || "Someone")}</b> recommended <b>${esc(r.movie_title)}</b>
              ${r.note ? `<div class="notif-note">“${esc(r.note)}”</div>` : ""}
            </div>`
          )
          .join("")
      : '<div class="notif-empty">No notifications yet.</div>';
    menu.innerHTML = `<div class="notif-head">Notifications</div>${body}`;
    menu.querySelectorAll(".notif-item").forEach((it) =>
      it.addEventListener("click", () => {
        menu.classList.add("hidden");
        openMovie(Number(it.dataset.mid), it.dataset.mt);
      })
    );
    markRecsSeen();
  } catch {
    menu.innerHTML = `<div class="notif-head">Notifications</div><div class="notif-empty">No notifications.</div>`;
  }
}

async function loadIncomingRecs(userId) {
  try {
    const recs = await DB.getIncomingRecommendations(userId);
    const sec = $("#recsSection");
    if (!sec || !recs.length) return;
    sec.innerHTML = `<div class="profile-section">
      <h3>Recommended for you <span class="muted small">— from people you're connected with</span></h3>
      <div class="recs-row">${recs.map(recCard).join("")}</div>
    </div>`;
    sec.querySelectorAll(".rec-card").forEach((c) => {
      c.addEventListener("click", () => openMovie(Number(c.dataset.mid), c.dataset.mt));
      c.querySelector(".rec-dismiss")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        await DB.dismissRecommendation(c.dataset.id);
        c.remove();
      });
    });
  } catch {
    /* recommendations table may not exist yet — skip */
  }
}

function likeCard(l) {
  const realId = decodeRealId(l.movie_id);
  const mt = decodeType(l.movie_id);
  const poster = l.movie_poster
    ? `<img class="poster" loading="lazy" src="${TMDB.IMG}${l.movie_poster}" alt="${esc(l.movie_title)}" />`
    : `<div class="poster placeholder">${esc(l.movie_title)}</div>`;
  return `<div class="top5-card" data-mid="${realId}" data-mt="${mt}">${mt === "tv" ? '<span class="media-tag">TV</span>' : ""}${poster}<div class="top5-title">${esc(l.movie_title)}</div></div>`;
}

function renderProfile(userId, profile, counts, following, isSelf, likes = [], lists = []) {
  const name = profile?.display_name || "User";
  const bio = profile?.bio || "";
  const top = Array.isArray(profile?.top_movies) ? profile.top_movies : [];
  const view = $("#profileView");

  view.innerHTML = `
    <div class="profile-head">
      <div class="profile-avatar-wrap">
        ${avatarHTML(profile, name, "lg")}
        ${isSelf ? '<button class="avatar-edit" id="avatarEdit" title="Change photo">✎</button>' : ""}
      </div>
      <div class="profile-info">
        <h2 class="profile-name">${esc(name)}</h2>
        <div class="profile-stats">
          <span class="stat-link" id="followersLink"><b id="followerCount">${counts.followers}</b> followers</span>
          <span class="stat-link" id="followingLink"><b>${counts.following}</b> following</span>
        </div>
        <p class="profile-bio" id="profileBio">${bio ? esc(bio) : `<span class="muted">${isSelf ? "Add a bio…" : ""}</span>`}</p>
        <div class="profile-actions">
          ${
            isSelf
              ? '<button class="btn btn-ghost" id="editProfileBtn">Edit bio</button>'
              : `<button class="btn ${following ? "btn-watch active" : "btn-primary"}" id="followBtn">${following ? "Following ✓" : "Follow"}</button>`
          }
          <button class="btn btn-ghost" id="shareProfile">↗ Share</button>
        </div>
      </div>
    </div>

    ${isSelf ? '<div id="recsSection"></div>' : ""}

    <div class="profile-section">
      <h3>Top 5 ${isSelf ? '<span class="muted small">— add from any movie’s page</span>' : ""}</h3>
      <div class="top5-row">
        ${
          top.length
            ? top.map((mv, i) => top5Card(mv, i, isSelf)).join("")
            : `<p class="empty">${isSelf ? 'No favourites yet — open a movie and tap "Add to Top 5".' : "No favourites yet."}</p>`
        }
      </div>
    </div>

    <div class="profile-section">
      <h3>Liked ${likes.length ? `<span class="muted small">${likes.length}</span>` : ""} ${isSelf ? '<span class="muted small">— tap ♡ on any movie</span>' : ""}</h3>
      <div class="top5-row">
        ${
          likes.length
            ? likes.map(likeCard).join("")
            : `<p class="empty">${isSelf ? "No liked movies yet — open a movie and tap ♡ Like." : "No liked movies yet."}</p>`
        }
      </div>
    </div>

    ${
      lists.length
        ? `<div class="profile-section">
            <h3>Lists ${`<span class="muted small">${lists.length}</span>`}</h3>
            <div class="lists-grid">${lists.map(listCardHTML).join("")}</div>
          </div>`
        : ""
    }

    <div class="profile-section">
      <h3>Watched</h3>
      <div class="grid" id="watchedGrid"></div>
      <div class="grid-status" id="watchedStatus"></div>
    </div>
  `;

  if (isSelf) {
    $("#avatarEdit").addEventListener("click", () => $("#avatarInput").click());
    $("#editProfileBtn").addEventListener("click", () => editBio(userId));
    view.querySelectorAll(".top5-remove").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        removeTopMovie(Number(b.dataset.id));
      })
    );
  } else {
    $("#followBtn").addEventListener("click", () => toggleFollow(userId));
  }
  $("#followersLink").addEventListener("click", () => openPeopleList(name + " · Followers", userId, "followers"));
  $("#followingLink").addEventListener("click", () => openPeopleList(name + " · Following", userId, "following"));
  $("#shareProfile").addEventListener("click", (e) =>
    shareLink(shareBase() + "?user=" + userId, e.currentTarget)
  );
  view.querySelectorAll(".top5-card").forEach((c) =>
    c.addEventListener("click", () => openMovie(Number(c.dataset.mid), c.dataset.mt))
  );
  view.querySelectorAll(".list-card").forEach((c) =>
    c.addEventListener("click", () => openListDetail(c.dataset.id))
  );

  initWatched(userId);
}

// Infinite-scroll list of the user's watched (rated) movies.
async function initWatched(userId) {
  const grid = $("#watchedGrid");
  const status = $("#watchedStatus");
  let from = 0;
  const size = 18;
  let done = false;
  let loading = false;
  if (watchedObserver) watchedObserver.disconnect();

  const loadPage = async () => {
    if (done || loading) return;
    loading = true;
    status.textContent = "Loading…";
    try {
      const rows = await DB.getUserRatingsPage(userId, from, size);
      rows.forEach((r) => {
        const card = movieCard(cardFromRow(r));
        card.querySelector(".card-meta").innerHTML =
          `<span>${esc(r.movie_year || "—")}</span><span class="badge-star">★ ${Number(r.rating).toFixed(1)}</span>`;
        grid.appendChild(card);
      });
      from += rows.length;
      if (rows.length < size) {
        done = true;
        status.textContent = grid.children.length ? "" : "No movies watched yet.";
      } else {
        status.textContent = "";
      }
    } catch (err) {
      status.textContent = "⚠️ " + err.message;
      done = true;
    }
    loading = false;
  };

  await loadPage();
  watchedObserver = new IntersectionObserver(
    (entries) => entries[0].isIntersecting && loadPage(),
    { rootMargin: "300px" }
  );
  watchedObserver.observe(status);
}

function editBio(userId) {
  const current = state.myProfile?.bio || "";
  $("#profileBio").innerHTML = `
    <textarea id="bioInput" class="bio-input" maxlength="200" placeholder="Write a short bio…">${esc(current)}</textarea>
    <div class="bio-actions">
      <button class="btn btn-primary" id="bioSave">Save</button>
      <button class="btn btn-ghost" id="bioCancel">Cancel</button>
    </div>`;
  $("#bioSave").addEventListener("click", async () => {
    const val = $("#bioInput").value.trim();
    const { error } = await DB.updateProfile(userId, { bio: val });
    if (!error) {
      state.myProfile.bio = val;
      openProfile(userId);
    }
  });
  $("#bioCancel").addEventListener("click", () => openProfile(userId));
}

async function onAvatarPicked(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const url = await DB.uploadAvatar(state.user.id, file);
    await DB.updateProfile(state.user.id, { avatar_url: url });
    state.myProfile.avatar_url = url;
    updateAccountIcons();
    if (state.mode === "profile") openProfile(state.user.id);
  } catch (err) {
    alert("Couldn't upload photo: " + err.message);
  }
}

async function toggleFollow(userId) {
  const btn = $("#followBtn");
  btn.disabled = true;
  const currently = btn.classList.contains("active");
  try {
    const { error } = currently
      ? await DB.unfollow(state.user.id, userId)
      : await DB.follow(state.user.id, userId);
    if (error) throw error;
  } catch {
    btn.disabled = false;
    return;
  }
  openProfile(userId);
}

async function removeTopMovie(id) {
  const top = (state.myProfile?.top_movies || []).filter((x) => x.id !== id);
  const { error } = await DB.updateProfile(state.user.id, { top_movies: top });
  if (error) return;
  state.myProfile.top_movies = top;
  state.topMovieIds = new Set(top.map((x) => x.id));
  openProfile(state.user.id);
}

// =====================================================
//  FOLLOWERS / FOLLOWING LIST (in the modal)
// =====================================================
function personRow(p) {
  const name = p.display_name || "User";
  return `<div class="person-row" data-uid="${p.id}">
    ${avatarHTML(p, name)}
    <span class="person-row-name">${esc(name)}</span>
  </div>`;
}

async function openPeopleList(title, userId, kind) {
  const modal = $("#modal");
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  $("#modalBody").innerHTML = `<div class="people-list-head"><h2>${esc(title)}</h2></div><div class="grid-status">Loading…</div>`;
  try {
    const people = kind === "followers" ? await DB.getFollowers(userId) : await DB.getFollowing(userId);
    const body = people.length
      ? `<div class="people-list">${people.map(personRow).join("")}</div>`
      : '<p class="empty" style="padding:20px 24px">Nobody yet.</p>';
    $("#modalBody").innerHTML = `<div class="people-list-head"><h2>${esc(title)}</h2></div>${body}`;
    $("#modalBody")
      .querySelectorAll(".person-row")
      .forEach((r) =>
        r.addEventListener("click", () => {
          closeModal();
          openProfile(r.dataset.uid);
        })
      );
  } catch (err) {
    $("#modalBody").innerHTML = `<div class="grid-status">⚠️ ${esc(err.message)}</div>`;
  }
}

// =====================================================
//  PERSON PAGE (actor / director bio + filmography)
// =====================================================
async function openPerson(personId) {
  openSheet(`<div class="grid-status">Loading…</div>`);
  try {
    const p = await TMDB.getPerson(personId);
    renderPerson(p);
  } catch (err) {
    $("#sheetBody").innerHTML = `<div class="grid-status">⚠️ ${esc(err.message)}</div>`;
  }
}

function personFilmCard(c) {
  const mt = c.media_type === "tv" ? "tv" : "movie";
  const title = c.title || c.name || "Untitled";
  const date = c.release_date || c.first_air_date || "";
  const poster = c.poster_path
    ? `<img class="poster" loading="lazy" src="${TMDB.IMG}${c.poster_path}" alt="${esc(title)}" />`
    : `<div class="poster placeholder">${esc(title)}</div>`;
  const sub = c.character ? "as " + c.character : c.job || "";
  return `<div class="pfilm-card" data-mid="${c.id}" data-mt="${mt}">
    <span class="media-tag ${mt}">${mt === "tv" ? "TV" : "FILM"}</span>
    ${poster}
    <div class="pfilm-title">${esc(title)}${date ? ` <span class="muted">${date.slice(0, 4)}</span>` : ""}</div>
    ${sub ? `<div class="pfilm-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

function dedupeCredits(list) {
  const seen = new Set();
  return list.filter((c) => {
    const k = (c.media_type || "movie") + ":" + c.id;
    if (seen.has(k) || (!c.title && !c.name)) return false;
    seen.add(k);
    return true;
  });
}

function renderPerson(p) {
  const photo = p.profile_path
    ? `<img class="person-photo" src="${TMDB.IMG_PROFILE}${p.profile_path}" alt="${esc(p.name)}" />`
    : `<div class="person-photo placeholder">${esc((p.name || "?").slice(0, 1))}</div>`;
  const bornBits = [p.birthday, p.place_of_birth].filter(Boolean).join(" · ");
  const acting = dedupeCredits([...(p.combined_credits?.cast || [])]).sort(
    (a, b) => (b.popularity || 0) - (a.popularity || 0)
  );
  const directed = dedupeCredits(
    (p.combined_credits?.crew || []).filter((c) => c.job === "Director")
  ).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const bio = (p.biography || "").trim();

  $("#sheetBody").innerHTML = `
    <div class="person-head">
      ${photo}
      <div class="person-meta">
        <h2>${esc(p.name)}</h2>
        ${p.known_for_department ? `<div class="muted small">${esc(p.known_for_department)}</div>` : ""}
        ${bornBits ? `<div class="person-born">${esc(bornBits)}</div>` : ""}
      </div>
    </div>
    ${bio ? `<p class="person-bio">${esc(bio)}</p>` : ""}
    ${
      directed.length
        ? `<div class="person-section"><h3>Directed</h3>
            <div class="pfilm-grid">${directed.slice(0, 16).map(personFilmCard).join("")}</div></div>`
        : ""
    }
    ${
      acting.length
        ? `<div class="person-section"><h3>Acting</h3>
            <div class="pfilm-grid">${acting.slice(0, 30).map(personFilmCard).join("")}</div></div>`
        : ""
    }
  `;
  $("#sheetBody")
    .querySelectorAll(".pfilm-card")
    .forEach((c) =>
      c.addEventListener("click", () => {
        closeSheet();
        openMovie(Number(c.dataset.mid), c.dataset.mt);
      })
    );
}

// =====================================================
//  SHARING (deep links)
// =====================================================
const shareBase = () => location.origin + location.pathname;

async function shareLink(url, btn) {
  if (navigator.share) {
    try {
      await navigator.share({ url });
    } catch {
      /* user cancelled */
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    const old = btn.textContent;
    btn.textContent = "✓ Link copied!";
    setTimeout(() => (btn.textContent = old), 1500);
  } catch {
    prompt("Copy this link:", url);
  }
}

// On first load after sign-in, honour ?movie=ID or ?user=ID in the URL.
let deepLinkHandled = false;
function applyDeepLink() {
  if (deepLinkHandled) return;
  deepLinkHandled = true;
  const params = new URLSearchParams(location.search);
  const movieId = params.get("movie");
  const tvId = params.get("tv");
  const userId = params.get("user");
  if (movieId) openMovie(Number(movieId), "movie");
  else if (tvId) openMovie(Number(tvId), "tv");
  else if (userId) openProfile(userId);
}

// =====================================================
//  PER-EPISODE RATING (series)
// =====================================================
function setupEpisodeScope() {
  document.querySelectorAll(".rate-scope-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const ep = b.dataset.rscope === "episodes";
      document.querySelectorAll(".rate-scope-btn").forEach((x) => x.classList.toggle("active", x === b));
      $("#seriesRateBox").classList.toggle("hidden", ep);
      $("#episodeRateBox").classList.toggle("hidden", !ep);
      if (ep && !$("#episodeList").querySelector(".ep-row")) loadEpisodes($("#seasonSelect").value);
    })
  );
  $("#seasonSelect")?.addEventListener("change", (e) => loadEpisodes(e.target.value));
}

async function loadEpisodes(seasonNumber) {
  const tvId = modalState.movie.id;
  const list = $("#episodeList");
  list.innerHTML = `<p class="empty">Loading episodes…</p>`;
  try {
    const data = await TMDB.getSeason(tvId, seasonNumber);
    const eps = data.episodes || [];
    if (!eps.length) {
      list.innerHTML = `<p class="empty">No episodes found.</p>`;
      return;
    }
    const seasonId = encodeSeason(tvId, seasonNumber);
    const epIds = eps.map((e) => encodeEpisode(tvId, seasonNumber, e.episode_number));
    const ids = [seasonId, ...epIds];
    let ratings = [];
    try {
      ratings = await DB.getRatingsForIds(ids);
    } catch {
      /* ignore */
    }
    const mine = {};
    const comm = {};
    ratings.forEach((r) => {
      const mid = Number(r.movie_id);
      (comm[mid] = comm[mid] || []).push(Number(r.rating));
      if (r.user_id === state.user.id) mine[mid] = Number(r.rating);
    });
    // Your average across the episodes you've rated this season
    const myEpVals = epIds.map((id) => mine[id]).filter(Boolean);
    const myEpAvg = myEpVals.length ? myEpVals.reduce((s, x) => s + x, 0) / myEpVals.length : null;
    const sMy = mine[seasonId] || 0;
    const sComm = comm[seasonId];
    const sAvg = sComm && sComm.length ? sComm.reduce((s, x) => s + x, 0) / sComm.length : null;
    const seasonRow = `<div class="ep-row season-row" data-eid="${seasonId}" data-kind="season">
        <div class="ep-info">
          <div class="ep-title"><span class="ep-num">SEASON ${seasonNumber}</span> Rate the whole season</div>
          <div class="ep-sub">${sAvg != null ? `★ ${sAvg.toFixed(1)} · ${sComm.length}` : '<span class="muted">no season ratings yet</span>'}${myEpAvg != null ? ` · your episodes avg ★ ${myEpAvg.toFixed(1)} (${myEpVals.length})` : ""}</div>
        </div>
        <div class="ep-rate">
          <span class="star-rate input ep-stars" data-eid="${seasonId}"><span class="layer bg">★★★★★</span><span class="layer fill" style="width:${(sMy / 5) * 100}%">★★★★★</span></span>
          <span class="ep-readout">${sMy ? sMy.toFixed(1) : "—"}</span>
        </div>
      </div>`;
    list.innerHTML = seasonRow + eps
      .map((e) => {
        const eid = encodeEpisode(tvId, seasonNumber, e.episode_number);
        const my = mine[eid] || 0;
        const c = comm[eid];
        const avg = c && c.length ? c.reduce((s, x) => s + x, 0) / c.length : null;
        return `<div class="ep-row" data-eid="${eid}" data-ep="${e.episode_number}" data-name="${esc(e.name || "")}" data-air="${esc(e.air_date || "")}">
          <div class="ep-info">
            <div class="ep-title"><span class="ep-num">E${e.episode_number}</span> ${esc(e.name || "Episode " + e.episode_number)}</div>
            <div class="ep-sub">${avg != null ? `★ ${avg.toFixed(1)} · ${c.length} rating${c.length === 1 ? "" : "s"}` : '<span class="muted">no ratings yet</span>'}</div>
          </div>
          <div class="ep-rate">
            <span class="star-rate input ep-stars" data-eid="${eid}"><span class="layer bg">★★★★★</span><span class="layer fill" style="width:${(my / 5) * 100}%">★★★★★</span></span>
            <span class="ep-readout">${my ? my.toFixed(1) : "—"}</span>
          </div>
        </div>`;
      })
      .join("");
    wireEpisodeStars(seasonNumber);
  } catch (err) {
    list.innerHTML = `<p class="empty">⚠️ ${esc(err.message)}</p>`;
  }
}

function wireEpisodeStars(seasonNumber) {
  const seriesTitle = modalState.movie.title;
  const poster = modalState.movie.poster_path || null;
  $("#episodeList")
    .querySelectorAll(".ep-stars")
    .forEach((widget) => {
      const fill = widget.querySelector(".fill");
      const row = widget.closest(".ep-row");
      const readout = row.querySelector(".ep-readout");
      const eid = Number(widget.dataset.eid);
      let committed = parseFloat(readout.textContent) || 0;
      const valFromEvent = (e) => {
        const rect = widget.getBoundingClientRect();
        const x = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
        return Math.min(5, Math.max(0.5, Math.ceil((x / rect.width) * 10) / 2));
      };
      const show = (v) => {
        fill.style.width = (v / 5) * 100 + "%";
        readout.textContent = v ? v.toFixed(1) : "—";
      };
      widget.addEventListener("mousemove", (e) => show(valFromEvent(e)));
      widget.addEventListener("mouseleave", () => show(committed));
      const commit = async (e) => {
        e.preventDefault();
        const v = valFromEvent(e);
        committed = v;
        fill.style.width = (v / 5) * 100 + "%";
        readout.textContent = "…";
        const title =
          row.dataset.kind === "season"
            ? `${seriesTitle} — Season ${seasonNumber}`
            : `${seriesTitle} — S${seasonNumber}E${row.dataset.ep}${row.dataset.name ? ": " + row.dataset.name : ""}`;
        const { error } = await DB.upsertRating({
          movie: { id: eid, title, poster_path: poster, release_date: row.dataset.air || "" },
          rating: v,
          mode: "simple",
          review: null,
          user: state.user,
        });
        readout.textContent = error ? "⚠️" : v.toFixed(1);
      };
      widget.addEventListener("click", commit);
      widget.addEventListener("touchstart", commit, { passive: false });
    });
}

// =====================================================
//  MOVIE DETAIL MODAL
// =====================================================
let modalState = { movie: null, mediaType: "movie", storeId: 0, myRating: 0, myMode: "simple", myAspects: emptyAspects(), ratings: [], likeCount: 0, trailer: null };

async function openMovie(id, mediaType = "movie") {
  if (mediaType === "episode" || mediaType === "season") mediaType = "tv"; // open the parent series
  const modal = $("#modal");
  modal.classList.remove("hidden");
  $("#modalBody").innerHTML = `<div class="grid-status">Loading…</div>`;
  document.body.style.overflow = "hidden";
  const storeId = encodeId(id, mediaType);

  try {
    const [raw, ratings, likeCount] = await Promise.all([
      mediaType === "tv" ? TMDB.getTV(id) : TMDB.getMovie(id),
      DB.getMovieRatings(storeId).catch(() => []),
      DB.getMovieLikeCount(storeId).catch(() => 0),
    ]);
    const movie = {
      ...raw,
      media_type: mediaType,
      title: raw.title || raw.name,
      release_date: raw.release_date || raw.first_air_date || "",
    };
    modalState.movie = movie;
    modalState.mediaType = mediaType;
    modalState.storeId = storeId;
    modalState.ratings = ratings;
    modalState.likeCount = likeCount;
    modalState.trailer = TMDB.trailerKey(raw.videos);
    const mine = ratings.find((r) => r.user_id === state.user.id);
    modalState.myRating = mine ? Number(mine.rating) : 0;
    modalState.myMode = mine?.mode || "simple";
    modalState.myAspects = mine
      ? {
          movie: num(mine.rating_movie),
          directing: num(mine.rating_directing),
          acting: num(mine.rating_acting),
          music: num(mine.rating_music),
          scenario: num(mine.rating_scenario),
        }
      : emptyAspects();
    renderModal();
  } catch (err) {
    $("#modalBody").innerHTML = `<div class="grid-status">⚠️ ${esc(err.message)}</div>`;
  }
}

function closeModal() {
  $("#modal").classList.add("hidden");
  document.body.style.overflow = "";
}

// ---- Sheet overlay (recommend picker) ----
function openSheet(html) {
  $("#sheetBody").innerHTML = html;
  $("#sheet").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  $("#sheet").classList.add("hidden");
  if ($("#modal").classList.contains("hidden")) document.body.style.overflow = "";
}

function recRow(p) {
  const name = p.display_name || "User";
  return `<div class="rec-row" data-uid="${p.id}">
    ${avatarHTML(p, name)}
    <span class="person-row-name">${esc(name)}</span>
    <button class="btn btn-primary rec-send">Send</button>
  </div>`;
}

async function openRecommendPicker(movie) {
  const head = `<div class="people-list-head"><h2>Recommend “${esc(movie.title)}”</h2></div>
    <div class="recommend-note"><input id="recNote" maxlength="140" placeholder="Add a note (optional)…" /></div>`;
  openSheet(head + `<div class="grid-status">Loading your people…</div>`);
  try {
    const [following, followers] = await Promise.all([
      DB.getFollowing(state.user.id),
      DB.getFollowers(state.user.id),
    ]);
    const map = new Map();
    [...following, ...followers].forEach((p) => map.set(p.id, p));
    const people = [...map.values()];
    const list = people.length
      ? `<div class="people-list">${people.map(recRow).join("")}</div>`
      : '<p class="empty" style="padding:20px 24px">Follow someone (or get a follower) first — then you can recommend movies to them.</p>';
    $("#sheetBody").innerHTML = head + list;
    $("#sheetBody")
      .querySelectorAll(".rec-row")
      .forEach((row) =>
        row.querySelector(".rec-send").addEventListener("click", async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          const { error } = await DB.recommendMovie({
            from: state.user,
            to: row.dataset.uid,
            movie: storable(movie, movie.media_type || "movie"),
            note: $("#recNote").value,
          });
          btn.textContent = error ? "⚠️" : "Sent ✓";
        })
      );
  } catch (err) {
    $("#sheetBody").innerHTML = `<div class="grid-status">⚠️ ${esc(err.message)}</div>`;
  }
}

function communityAvg(ratings) {
  if (!ratings.length) return null;
  return ratings.reduce((s, r) => s + Number(r.rating), 0) / ratings.length;
}

// Average of each aspect across the detailed ratings that supplied it.
function communityAspectAverages(ratings) {
  const res = {};
  for (const [key, , col] of ASPECTS) {
    const vals = ratings.map((r) => r[col]).filter((v) => v != null).map(Number);
    res[key] = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  }
  return res;
}

// Display-only fractional stars (supports half steps, e.g. 3.5).
function starsDisplay(value, sizeClass = "") {
  const pct = (Math.max(0, Math.min(5, Number(value) || 0)) / 5) * 100;
  return `<span class="star-rate ${sizeClass}">
    <span class="layer bg">★★★★★</span>
    <span class="layer fill" style="width:${pct}%">★★★★★</span>
  </span>`;
}

// Interactive star widget (0.5 steps). `key` is "overall" or an aspect key.
function starWidgetHTML(key, value) {
  const pct = ((Number(value) || 0) / 5) * 100;
  return `<span class="star-rate input" data-key="${key}">
    <span class="layer bg">★★★★★</span>
    <span class="layer fill" style="width:${pct}%">★★★★★</span>
  </span>`;
}
function readoutHTML(key, value) {
  return `<span class="rate-readout" data-key="${key}">${value ? Number(value).toFixed(1) : "—"}</span>`;
}

// Average of the 5 aspects, rounded to one decimal — or null if any unset.
function detailedAverage() {
  const a = modalState.myAspects;
  const vals = ASPECTS.map(([k]) => a[k]);
  if (vals.some((v) => !v)) return null;
  return Math.round((vals.reduce((s, x) => s + x, 0) / 5) * 10) / 10;
}
function updateDetailedAvg() {
  const node = $("#detailedAvg");
  if (!node) return;
  const avg = detailedAverage();
  node.textContent = avg != null ? avg.toFixed(1) : "—";
}

function renderModal() {
  const m = modalState.movie;
  const myExisting = modalState.ratings.find((r) => r.user_id === state.user.id);
  const avg = communityAvg(modalState.ratings);
  const backdrop = m.backdrop_path
    ? `<img class="detail-backdrop" src="${TMDB.IMG_BACKDROP}${m.backdrop_path}" alt="" />`
    : `<div class="detail-backdrop"></div>`;
  const poster = m.poster_path
    ? `<img class="detail-poster" src="${TMDB.IMG}${m.poster_path}" alt="${esc(m.title)}" />`
    : `<div class="detail-poster"></div>`;

  const reviews = modalState.ratings.filter((r) => r.review);
  const aspectAvgs = communityAspectAverages(modalState.ratings);
  const hasAspectData = Object.values(aspectAvgs).some((v) => v != null);

  const isTV = modalState.mediaType === "tv";
  const crew = m.credits?.crew || [];
  const cast = m.credits?.cast || [];
  const directors = isTV ? m.created_by || [] : crew.filter((c) => c.job === "Director");
  const creditLabel = isTV ? "Created by" : "Directed by";
  const providers = TMDB.watchProviders(m);
  const similar = (m.recommendations?.results || [])
    .slice(0, 12)
    .map((it) => TMDB.normalizeItem(it, modalState.mediaType));
  const subMeta = isTV
    ? m.number_of_seasons
      ? "· " + m.number_of_seasons + " season" + (m.number_of_seasons === 1 ? "" : "s")
      : ""
    : m.runtime
      ? "· " + m.runtime + " min"
      : "";
  const castCard = (c) => {
    const photo = c.profile_path
      ? `<img class="cast-photo" loading="lazy" src="${TMDB.IMG_PROFILE}${c.profile_path}" alt="${esc(c.name)}" />`
      : `<div class="cast-photo placeholder">${esc(c.name.slice(0, 1))}</div>`;
    return `<div class="cast-card" data-pid="${c.id}">
      ${photo}
      <div class="cast-name">${esc(c.name)}</div>
      <div class="cast-char">${esc(c.character || "")}</div>
    </div>`;
  };

  $("#modalBody").innerHTML = `
    <div class="detail-hero">
      ${backdrop}
      ${modalState.trailer ? '<button class="trailer-btn" id="trailerBtn">▶ Play trailer</button>' : ""}
    </div>
    <div class="detail-main">
      ${poster}
      <div class="detail-info">
        <h2>${esc(m.title)}</h2>
        <div class="detail-sub">
          ${TMDB.year(m.release_date) || ""} ${subMeta}
          ${m.genres?.length ? "· " + m.genres.map((g) => esc(g.name)).join(", ") : ""}
        </div>
        ${directors.length ? `<div class="detail-director">🎬 ${creditLabel} ${directors.map((d) => `<b class="person-link" data-pid="${d.id}">${esc(d.name)}</b>`).join(", ")}</div>` : ""}
        <p class="detail-overview">${esc(m.overview || "No synopsis available.")}</p>
        <div class="detail-actions">
          <button class="btn btn-watch" id="likeToggle"></button>
          <button class="btn btn-watch" id="watchToggle"></button>
          <button class="btn btn-watch" id="top5Toggle"></button>
          <button class="btn btn-watch" id="listToggle">＋ List</button>
          <button class="btn btn-watch" id="recommendMovie">📨 Recommend</button>
          <button class="btn btn-watch" id="shareMovie">↗ Share</button>
        </div>
      </div>
    </div>

    ${
      cast.length
        ? `<div class="cast">
            <h3>Cast</h3>
            <div class="cast-row">${cast.slice(0, 15).map(castCard).join("")}</div>
          </div>`
        : ""
    }

    ${
      providers.length
        ? `<div class="cast">
            <h3>Where to watch</h3>
            <div class="provider-row">
              ${providers
                .map(
                  (p) => `<div class="provider" title="${esc(p.provider_name)}">
                    <img src="${TMDB.IMG_LOGO}${p.logo_path}" alt="${esc(p.provider_name)}" />
                    <span>${esc(p.provider_name)}</span>
                  </div>`
                )
                .join("")}
            </div>
          </div>`
        : ""
    }

    ${
      similar.length
        ? `<div class="cast">
            <h3>More like this</h3>
            <div class="cast-row">
              ${similar
                .map(
                  (s) => `<div class="sim-card" data-mid="${s.id}" data-mt="${s.media_type}">
                    ${
                      s.poster_path
                        ? `<img class="cast-photo" loading="lazy" src="${TMDB.IMG}${s.poster_path}" alt="${esc(s.title)}" />`
                        : `<div class="cast-photo placeholder">${esc(s.title.slice(0, 1))}</div>`
                    }
                    <div class="cast-name">${esc(s.title)}</div>
                  </div>`
                )
                .join("")}
            </div>
          </div>`
        : ""
    }

    <div class="score-row">
      <div class="score-box">
        <div class="score-num"><span class="star">★</span> ${avg ? avg.toFixed(1) : "–"}<span style="font-size:14px;color:var(--muted)">/5</span></div>
        <div class="score-label">CineRate · ${modalState.ratings.length} rating${modalState.ratings.length === 1 ? "" : "s"}</div>
      </div>
      <div class="score-box">
        <div class="score-num"><span class="star">★</span> ${m.vote_average ? m.vote_average.toFixed(1) : "–"}<span style="font-size:14px;color:var(--muted)">/10</span></div>
        <div class="score-label">TMDB score</div>
      </div>
      <div class="score-box">
        <div class="score-num" id="likeCountNum"><span class="heart">♥</span> ${modalState.likeCount}</div>
        <div class="score-label">Likes</div>
      </div>
    </div>

    ${
      hasAspectData
        ? `<div class="aspect-breakdown">
            ${ASPECTS.map(
              ([key, label]) => `
              <div class="ab-item">
                <span class="ab-label">${label}</span>
                <span class="ab-val">${aspectAvgs[key] != null ? aspectAvgs[key].toFixed(1) : "–"}</span>
              </div>`
            ).join("")}
          </div>`
        : ""
    }

    ${
      isTV
        ? `<div class="rate-scope">
            <button class="rate-scope-btn active" data-rscope="series">★ Whole series</button>
            <button class="rate-scope-btn" data-rscope="episodes">📺 By episode</button>
          </div>`
        : ""
    }

    <div class="rate-box" id="seriesRateBox">
      <div class="rate-head">
        <h3>${myExisting ? "Your rating" : isTV ? "Rate the whole series" : "Rate this movie"}</h3>
        <div class="mode-toggle">
          <button class="mode-btn ${modalState.myMode === "simple" ? "active" : ""}" data-mode="simple">★ Simple</button>
          <button class="mode-btn ${modalState.myMode === "detailed" ? "active" : ""}" data-mode="detailed">🎬 By category</button>
        </div>
      </div>

      <p class="rate-hint ${modalState.myMode === "detailed" ? "hidden" : ""}" id="rateHint">
        Want to rate <b>movie, directing, acting, music & scenario</b> separately? Tap <b>🎬 By category</b>.
      </p>

      <div id="simpleRate" class="${modalState.myMode === "simple" ? "" : "hidden"}">
        <div class="rate-line">
          ${starWidgetHTML("overall", modalState.myRating)}
          ${readoutHTML("overall", modalState.myRating)}
        </div>
      </div>

      <div id="detailedRate" class="${modalState.myMode === "detailed" ? "" : "hidden"}">
        ${ASPECTS.map(
          ([key, label]) => `
          <div class="aspect-row">
            <span class="aspect-label">${label}</span>
            ${starWidgetHTML(key, modalState.myAspects[key])}
            ${readoutHTML(key, modalState.myAspects[key])}
          </div>`
        ).join("")}
        <div class="aspect-row aspect-avg">
          <span class="aspect-label">Average</span>
          <span class="detailed-avg-val" id="detailedAvg">${detailedAverage() != null ? detailedAverage().toFixed(1) : "—"}</span>
        </div>
      </div>

      <textarea id="reviewInput" placeholder="Add a review (optional)">${esc(myExisting?.review || "")}</textarea>
      <div class="rate-actions">
        <button class="btn btn-primary" id="saveRating">${myExisting ? "Update rating" : "Submit rating"}</button>
        ${myExisting ? '<button class="btn btn-danger" id="deleteRating">Remove</button>' : ""}
        <span id="rateStatus" style="color:var(--muted);font-size:13px"></span>
      </div>
    </div>

    ${
      isTV
        ? `<div class="rate-box hidden" id="episodeRateBox">
            <div class="rate-head">
              <h3>Rate episodes</h3>
              <select id="seasonSelect" class="genre-select">
                ${(m.seasons || [])
                  .filter((s) => s.season_number >= 1 && s.episode_count > 0)
                  .map((s) => `<option value="${s.season_number}">Season ${s.season_number}${s.name && !/^season/i.test(s.name) ? " · " + esc(s.name) : ""} (${s.episode_count})</option>`)
                  .join("")}
              </select>
            </div>
            <div id="episodeList"><p class="empty">Pick a season to start rating episodes.</p></div>
          </div>`
        : ""
    }

    <div class="reviews">
      <h3>Community reviews</h3>
      ${
        reviews.length
          ? reviews.map(reviewItem).join("")
          : '<p class="empty">No written reviews yet. Be the first!</p>'
      }
    </div>
  `;

  wireStarInputs($("#modalBody"));
  wireModeToggle();
  updateWatchBtn();
  updateTop5Btn();
  updateLikeBtn();
  $("#likeToggle").addEventListener("click", toggleLike);
  $("#watchToggle").addEventListener("click", toggleWatch);
  $("#top5Toggle").addEventListener("click", toggleTop5);
  $("#shareMovie").addEventListener("click", (e) =>
    shareLink(shareBase() + (modalState.mediaType === "tv" ? "?tv=" : "?movie=") + modalState.movie.id, e.currentTarget)
  );
  $("#recommendMovie").addEventListener("click", () => openRecommendPicker(modalState.movie));
  $("#listToggle").addEventListener("click", () => openListPicker());
  if (modalState.mediaType === "tv") setupEpisodeScope();
  $("#modalBody")
    .querySelectorAll(".sim-card")
    .forEach((c) => c.addEventListener("click", () => openMovie(Number(c.dataset.mid), c.dataset.mt)));
  $("#modalBody")
    .querySelectorAll(".cast-card[data-pid], .person-link[data-pid]")
    .forEach((c) =>
      c.addEventListener("click", (e) => {
        e.stopPropagation();
        openPerson(c.dataset.pid);
      })
    );
  $("#trailerBtn")?.addEventListener("click", () => {
    const hero = document.querySelector(".detail-hero");
    hero.innerHTML = `<iframe class="trailer-frame" src="https://www.youtube.com/embed/${modalState.trailer}?autoplay=1" title="Trailer" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  });
  $("#saveRating").addEventListener("click", saveRating);
  if (myExisting) $("#deleteRating").addEventListener("click", removeRating);
  $("#modalBody")
    .querySelectorAll(".author-link")
    .forEach((a) =>
      a.addEventListener("click", (e) => {
        e.stopPropagation();
        openProfile(a.dataset.uid);
      })
    );
}

function updateLikeBtn() {
  const btn = $("#likeToggle");
  if (!btn) return;
  const liked = state.likedIds.has(modalState.storeId);
  btn.textContent = liked ? "♥ Liked" : "♡ Like";
  btn.classList.toggle("liked", liked);
}

async function toggleLike() {
  const sid = modalState.storeId;
  const liked = state.likedIds.has(sid);
  const btn = $("#likeToggle");
  btn.disabled = true;
  const { error } = liked
    ? await DB.unlikeMovie(state.user.id, sid)
    : await DB.likeMovie({ movie: storable(modalState.movie, modalState.mediaType), user: state.user });
  btn.disabled = false;
  if (error) {
    btn.textContent = "⚠️ " + error.message;
    return;
  }
  if (liked) state.likedIds.delete(sid);
  else state.likedIds.add(sid);
  modalState.likeCount = Math.max(0, modalState.likeCount + (liked ? -1 : 1));
  const cnt = $("#likeCountNum");
  if (cnt) cnt.innerHTML = `<span class="heart">♥</span> ${modalState.likeCount}`;
  updateLikeBtn();
}

async function refreshLikedIds() {
  try {
    state.likedIds = new Set(await DB.getLikedIds(state.user.id));
  } catch {
    /* likes table may not exist yet */
  }
}

function updateTop5Btn() {
  const btn = $("#top5Toggle");
  if (!btn) return;
  const inTop = state.topMovieIds.has(modalState.storeId);
  const full = state.topMovieIds.size >= 5 && !inTop;
  btn.textContent = inTop ? "★ In your Top 5" : full ? "Top 5 full" : "＋ Add to Top 5";
  btn.classList.toggle("active", inTop);
  btn.disabled = full;
}

async function toggleTop5() {
  const m = modalState.movie;
  const sid = modalState.storeId;
  const inTop = state.topMovieIds.has(sid);
  let top = Array.isArray(state.myProfile?.top_movies) ? [...state.myProfile.top_movies] : [];
  if (inTop) {
    top = top.filter((x) => x.id !== sid);
  } else {
    if (top.length >= 5) return;
    top.push({
      id: sid,
      media_type: modalState.mediaType,
      title: m.title,
      poster: m.poster_path || null,
      year: (m.release_date || "").slice(0, 4) || null,
    });
  }
  const btn = $("#top5Toggle");
  btn.disabled = true;
  const { error } = await DB.updateProfile(state.user.id, { top_movies: top });
  if (error) {
    btn.textContent = "⚠️ " + error.message;
    return;
  }
  state.myProfile.top_movies = top;
  state.topMovieIds = new Set(top.map((x) => x.id));
  updateTop5Btn();
}

function wireModeToggle() {
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      modalState.myMode = btn.dataset.mode;
      document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
      $("#simpleRate").classList.toggle("hidden", modalState.myMode !== "simple");
      $("#detailedRate").classList.toggle("hidden", modalState.myMode !== "detailed");
      $("#rateHint")?.classList.toggle("hidden", modalState.myMode !== "simple");
    });
  });
}

function updateWatchBtn() {
  const btn = $("#watchToggle");
  if (!btn) return;
  const inList = state.watchlistIds.has(modalState.storeId);
  btn.textContent = inList ? "✓ In your watchlist" : "＋ Add to watchlist";
  btn.classList.toggle("active", inList);
}

async function toggleWatch() {
  const sid = modalState.storeId;
  const btn = $("#watchToggle");
  const inList = state.watchlistIds.has(sid);
  btn.disabled = true;
  try {
    if (inList) {
      const { error } = await DB.removeFromWatchlist(state.user.id, sid);
      if (error) throw error;
      state.watchlistIds.delete(sid);
    } else {
      const { error } = await DB.addToWatchlist({ movie: storable(modalState.movie, modalState.mediaType), user: state.user });
      if (error) throw error;
      state.watchlistIds.add(sid);
    }
  } catch (err) {
    btn.textContent = "⚠️ " + err.message;
    btn.disabled = false;
    return;
  }
  btn.disabled = false;
  updateWatchBtn();
  if (state.mode === "watch") loadWatchlist(); // keep the watchlist view in sync
}

function reviewItem(r) {
  const initials = (r.user_name || "?").slice(0, 1).toUpperCase();
  const date = new Date(r.updated_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return `
    <div class="review">
      <div class="review-avatar">${esc(initials)}</div>
      <div class="review-content">
        <div class="review-head">
          <span class="review-name author-link" data-uid="${r.user_id}">${esc(r.user_name || "Anonymous")}</span>
          ${starsDisplay(r.rating, "sm")}
          <span class="review-date">${date}</span>
        </div>
        <div class="review-text">${esc(r.review)}</div>
      </div>
    </div>`;
}

// Wire every interactive star widget inside `root`. Each widget's data-key is
// "overall" (simple mode) or an aspect key (detailed mode).
function wireStarInputs(root) {
  root.querySelectorAll(".star-rate.input").forEach((widget) => {
    const key = widget.dataset.key;
    const fill = widget.querySelector(".fill");
    const readout = root.querySelector(`.rate-readout[data-key="${key}"]`);
    const current = () => (key === "overall" ? modalState.myRating : modalState.myAspects[key]) || 0;

    const valFromEvent = (e) => {
      const rect = widget.getBoundingClientRect();
      const clientX = e.touches?.[0]?.clientX ?? e.clientX;
      const v = Math.ceil(((clientX - rect.left) / rect.width) * 10) / 2; // 0.5 steps
      return Math.min(5, Math.max(0.5, v));
    };
    const show = (v) => {
      fill.style.width = (v / 5) * 100 + "%";
      if (readout) readout.textContent = v.toFixed(1);
    };
    const reset = () => {
      const c = current();
      fill.style.width = (c / 5) * 100 + "%";
      if (readout) readout.textContent = c ? c.toFixed(1) : "—";
    };

    widget.addEventListener("mousemove", (e) => show(valFromEvent(e)));
    widget.addEventListener("mouseleave", reset);
    const commit = (e) => {
      e.preventDefault();
      const v = valFromEvent(e);
      if (key === "overall") modalState.myRating = v;
      else modalState.myAspects[key] = v;
      show(v);
      updateDetailedAvg();
    };
    widget.addEventListener("click", commit);
    widget.addEventListener("touchstart", commit, { passive: false });
  });
}

async function saveRating() {
  const mode = modalState.myMode;
  let rating;
  let aspects = null;

  if (mode === "detailed") {
    if (ASPECTS.some(([k]) => !modalState.myAspects[k])) {
      $("#rateStatus").textContent = "Rate all 5 aspects to submit a detailed rating.";
      return;
    }
    rating = detailedAverage();
    aspects = modalState.myAspects;
  } else {
    if (!modalState.myRating) {
      $("#rateStatus").textContent = "Pick a star rating first.";
      return;
    }
    rating = modalState.myRating;
  }

  $("#rateStatus").textContent = "Saving…";
  const { error } = await DB.upsertRating({
    movie: storable(modalState.movie, modalState.mediaType),
    rating,
    mode,
    aspects,
    review: $("#reviewInput").value,
    user: state.user,
  });
  if (error) {
    $("#rateStatus").textContent = "⚠️ " + error.message;
    return;
  }
  $("#rateStatus").textContent = "Saved!";
  modalState.ratings = await DB.getMovieRatings(modalState.storeId);
  renderModal();
}

async function removeRating() {
  const { error } = await DB.deleteRating(state.user.id, modalState.storeId);
  if (error) {
    $("#rateStatus").textContent = "⚠️ " + error.message;
    return;
  }
  modalState.myRating = 0;
  modalState.myMode = "simple";
  modalState.myAspects = emptyAspects();
  modalState.ratings = await DB.getMovieRatings(modalState.storeId);
  renderModal();
}

// =====================================================
//  GLOBAL WIRING
// =====================================================
function setupAppUI() {
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#searchInput").value.trim();
    if (q) loadSearch(q);
    else loadPopular();
  });

  document.querySelectorAll(".browse-btn").forEach((b) =>
    b.addEventListener("click", async () => {
      state.browseType = b.dataset.browse;
      state.genreId = "";
      document.querySelectorAll(".browse-btn").forEach((x) => x.classList.toggle("active", x === b));
      $("#searchInput").value = "";
      await loadGenres(state.browseType);
      loadPopular();
    })
  );

  document.querySelectorAll(".cat-pill").forEach((p) =>
    p.addEventListener("click", () => {
      state.category = p.dataset.cat;
      document.querySelectorAll(".cat-pill").forEach((x) => x.classList.toggle("active", x === p));
      loadPopular();
    })
  );
  $("#genreSelect").addEventListener("change", (e) => {
    state.genreId = e.target.value;
    loadPopular();
  });

  $("#loadMore").addEventListener("click", () => {
    const next = state.page + 1;
    if (state.mode === "search") loadSearch(state.query, next);
    else loadPopular(next);
  });

  $("#modal").querySelectorAll("[data-close]").forEach((n) =>
    n.addEventListener("click", closeModal)
  );
  $("#sheet").querySelectorAll("[data-sheet-close]").forEach((n) =>
    n.addEventListener("click", closeSheet)
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#sheet").classList.contains("hidden")) closeSheet();
    else if (!$("#modal").classList.contains("hidden")) closeModal();
  });
}

// =====================================================
//  BOOT
// =====================================================
function boot() {
  setupDevice();
  setupAuthUI();
  setupAppUI();

  if (configIncomplete()) {
    const warn = $("#configWarn");
    warn.classList.remove("hidden");
    warn.innerHTML =
      "⚙️ <b>Setup needed.</b> Open <code>js/config.js</code> and add your Supabase URL, Supabase anon key, and TMDB API key. See the README for the 3-minute walkthrough.";
    return; // don't try to talk to Supabase with placeholder keys
  }

  let appStarted = false; // init the app once per sign-in, not on every auth event
  DB.onAuth((session) => {
    state.user = session?.user || null;
    if (state.user) {
      if (appStarted) return; // ignore token refreshes / re-emitted SIGNED_IN
      appStarted = true;
      showApp();
      loadGenres(state.browseType);
      loadPopular();
      refreshWatchlistIds();
      refreshLikedIds();
      loadMyProfileState();
      refreshRecBadge();
      applyDeepLink();
    } else {
      appStarted = false;
      state.watchlistIds = new Set();
      state.likedIds = new Set();
      state.myProfile = null;
      state.topMovieIds = new Set();
      showAuthScreen();
    }
  });
}

boot();
