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
  mode: "popular", // popular | search | mine | watch
  query: "",
  page: 1,
  totalPages: 1,
  loading: false,
  watchlistIds: new Set(),
};

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
  $("#watchlistBtn").addEventListener("click", () => loadWatchlist());
  $("#myRatingsBtn").addEventListener("click", () => loadMine());
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
  const card = el(`
    <div class="card">
      ${poster}
      <div class="card-body">
        <div class="card-title">${esc(m.title)}</div>
        <div class="card-meta">
          <span>${TMDB.year(m.release_date) || "—"}</span>
          <span class="badge-star">★ ${m.vote_average ? m.vote_average.toFixed(1) : "–"}</span>
        </div>
      </div>
    </div>
  `);
  card.addEventListener("click", () => openMovie(m.id));
  return card;
}

function renderMovies(movies, append) {
  const grid = $("#grid");
  if (!append) grid.innerHTML = "";
  movies.forEach((m) => grid.appendChild(movieCard(m)));
}

async function loadPopular(page = 1) {
  state.mode = "popular";
  state.page = page;
  $("#sectionTitle").textContent = "Popular right now";
  await runLoad(() => TMDB.getPopular(page), page === 1);
}

async function loadSearch(query, page = 1) {
  state.mode = "search";
  state.query = query;
  state.page = page;
  $("#sectionTitle").textContent = `Results for “${query}”`;
  await runLoad(() => TMDB.searchMovies(query, page), page === 1);
}

async function runLoad(fetcher, reset) {
  if (state.loading) return;
  state.loading = true;
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
  $("#sectionTitle").textContent = "My ratings";
  $("#loadMore").classList.add("hidden");
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
      const m = {
        id: r.movie_id,
        title: r.movie_title,
        poster_path: r.movie_poster,
        release_date: r.movie_year || "",
        vote_average: null,
      };
      const card = movieCard(m);
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
  $("#sectionTitle").textContent = "Your watchlist";
  $("#loadMore").classList.add("hidden");
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
      const m = {
        id: r.movie_id,
        title: r.movie_title,
        poster_path: r.movie_poster,
        release_date: r.movie_year || "",
        vote_average: null,
      };
      const card = movieCard(m);
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
//  MOVIE DETAIL MODAL
// =====================================================
let modalState = { movie: null, myRating: 0, ratings: [] };

async function openMovie(id) {
  const modal = $("#modal");
  modal.classList.remove("hidden");
  $("#modalBody").innerHTML = `<div class="grid-status">Loading…</div>`;
  document.body.style.overflow = "hidden";

  try {
    const [movie, ratings] = await Promise.all([
      TMDB.getMovie(id),
      DB.getMovieRatings(id).catch(() => []),
    ]);
    modalState.movie = movie;
    modalState.ratings = ratings;
    modalState.myRating = ratings.find((r) => r.user_id === state.user.id)?.rating || 0;
    renderModal();
  } catch (err) {
    $("#modalBody").innerHTML = `<div class="grid-status">⚠️ ${esc(err.message)}</div>`;
  }
}

function closeModal() {
  $("#modal").classList.add("hidden");
  document.body.style.overflow = "";
}

function communityAvg(ratings) {
  if (!ratings.length) return null;
  return ratings.reduce((s, r) => s + r.rating, 0) / ratings.length;
}

// Display-only fractional stars (supports half steps, e.g. 3.5).
function starsDisplay(value, sizeClass = "") {
  const pct = (Math.max(0, Math.min(5, Number(value) || 0)) / 5) * 100;
  return `<span class="star-rate ${sizeClass}">
    <span class="layer bg">★★★★★</span>
    <span class="layer fill" style="width:${pct}%">★★★★★</span>
  </span>`;
}

// Interactive star widget for picking a rating in 0.5 steps.
function starsInput(value) {
  const pct = ((Number(value) || 0) / 5) * 100;
  return `<span class="star-rate input" id="starInput">
    <span class="layer bg">★★★★★</span>
    <span class="layer fill" id="starFill" style="width:${pct}%">★★★★★</span>
  </span>`;
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

  $("#modalBody").innerHTML = `
    <div class="detail-hero">${backdrop}</div>
    <div class="detail-main">
      ${poster}
      <div class="detail-info">
        <h2>${esc(m.title)}</h2>
        <div class="detail-sub">
          ${TMDB.year(m.release_date) || ""} ${m.runtime ? "· " + m.runtime + " min" : ""}
          ${m.genres?.length ? "· " + m.genres.map((g) => esc(g.name)).join(", ") : ""}
        </div>
        <p class="detail-overview">${esc(m.overview || "No synopsis available.")}</p>
        <div class="detail-actions">
          <button class="btn btn-watch" id="watchToggle"></button>
        </div>
      </div>
    </div>

    <div class="score-row">
      <div class="score-box">
        <div class="score-num"><span class="star">★</span> ${avg ? avg.toFixed(1) : "–"}<span style="font-size:14px;color:var(--muted)">/5</span></div>
        <div class="score-label">CineRate · ${modalState.ratings.length} rating${modalState.ratings.length === 1 ? "" : "s"}</div>
      </div>
      <div class="score-box">
        <div class="score-num"><span class="star">★</span> ${m.vote_average ? m.vote_average.toFixed(1) : "–"}<span style="font-size:14px;color:var(--muted)">/10</span></div>
        <div class="score-label">TMDB score</div>
      </div>
    </div>

    <div class="rate-box">
      <h3>${myExisting ? "Your rating" : "Rate this movie"}</h3>
      <div class="rate-line">
        ${starsInput(modalState.myRating)}
        <span class="rate-readout" id="rateReadout">${modalState.myRating ? Number(modalState.myRating).toFixed(1) : "—"}</span>
      </div>
      <textarea id="reviewInput" placeholder="Add a review (optional)">${esc(myExisting?.review || "")}</textarea>
      <div class="rate-actions">
        <button class="btn btn-primary" id="saveRating">${myExisting ? "Update rating" : "Submit rating"}</button>
        ${myExisting ? '<button class="btn btn-danger" id="deleteRating">Remove</button>' : ""}
        <span id="rateStatus" style="color:var(--muted);font-size:13px"></span>
      </div>
    </div>

    <div class="reviews">
      <h3>Community reviews</h3>
      ${
        reviews.length
          ? reviews.map(reviewItem).join("")
          : '<p class="empty">No written reviews yet. Be the first!</p>'
      }
    </div>
  `;

  wireStars();
  updateWatchBtn();
  $("#watchToggle").addEventListener("click", toggleWatch);
  $("#saveRating").addEventListener("click", saveRating);
  if (myExisting) $("#deleteRating").addEventListener("click", removeRating);
}

function updateWatchBtn() {
  const btn = $("#watchToggle");
  if (!btn) return;
  const inList = state.watchlistIds.has(modalState.movie.id);
  btn.textContent = inList ? "✓ In your watchlist" : "＋ Add to watchlist";
  btn.classList.toggle("active", inList);
}

async function toggleWatch() {
  const m = modalState.movie;
  const btn = $("#watchToggle");
  const inList = state.watchlistIds.has(m.id);
  btn.disabled = true;
  try {
    if (inList) {
      const { error } = await DB.removeFromWatchlist(state.user.id, m.id);
      if (error) throw error;
      state.watchlistIds.delete(m.id);
    } else {
      const { error } = await DB.addToWatchlist({ movie: m, user: state.user });
      if (error) throw error;
      state.watchlistIds.add(m.id);
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
          <span class="review-name">${esc(r.user_name || "Anonymous")}</span>
          ${starsDisplay(r.rating, "sm")}
          <span class="review-date">${date}</span>
        </div>
        <div class="review-text">${esc(r.review)}</div>
      </div>
    </div>`;
}

function wireStars() {
  const widget = $("#starInput");
  const fill = $("#starFill");
  const readout = $("#rateReadout");

  const valFromEvent = (e) => {
    const rect = widget.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const x = clientX - rect.left;
    const v = Math.ceil((x / rect.width) * 10) / 2; // snap to 0.5 steps
    return Math.min(5, Math.max(0.5, v));
  };
  const show = (v) => {
    fill.style.width = (v / 5) * 100 + "%";
    readout.textContent = v.toFixed(1);
  };

  widget.addEventListener("mousemove", (e) => show(valFromEvent(e)));
  widget.addEventListener("mouseleave", () => {
    fill.style.width = ((modalState.myRating || 0) / 5) * 100 + "%";
    readout.textContent = modalState.myRating ? Number(modalState.myRating).toFixed(1) : "—";
  });
  const commit = (e) => {
    e.preventDefault();
    modalState.myRating = valFromEvent(e);
    show(modalState.myRating);
  };
  widget.addEventListener("click", commit);
  widget.addEventListener("touchstart", commit, { passive: false });
}

async function saveRating() {
  if (!modalState.myRating) {
    $("#rateStatus").textContent = "Pick a star rating first.";
    return;
  }
  $("#rateStatus").textContent = "Saving…";
  const { error } = await DB.upsertRating({
    movie: modalState.movie,
    rating: modalState.myRating,
    review: $("#reviewInput").value,
    user: state.user,
  });
  if (error) {
    $("#rateStatus").textContent = "⚠️ " + error.message;
    return;
  }
  $("#rateStatus").textContent = "Saved!";
  modalState.ratings = await DB.getMovieRatings(modalState.movie.id);
  renderModal();
}

async function removeRating() {
  const { error } = await DB.deleteRating(state.user.id, modalState.movie.id);
  if (error) {
    $("#rateStatus").textContent = "⚠️ " + error.message;
    return;
  }
  modalState.myRating = 0;
  modalState.ratings = await DB.getMovieRatings(modalState.movie.id);
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

  $("#loadMore").addEventListener("click", () => {
    const next = state.page + 1;
    if (state.mode === "search") loadSearch(state.query, next);
    else loadPopular(next);
  });

  $("#modal").querySelectorAll("[data-close]").forEach((n) =>
    n.addEventListener("click", closeModal)
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#modal").classList.contains("hidden")) closeModal();
  });
}

// =====================================================
//  BOOT
// =====================================================
function boot() {
  setupAuthUI();
  setupAppUI();

  if (configIncomplete()) {
    const warn = $("#configWarn");
    warn.classList.remove("hidden");
    warn.innerHTML =
      "⚙️ <b>Setup needed.</b> Open <code>js/config.js</code> and add your Supabase URL, Supabase anon key, and TMDB API key. See the README for the 3-minute walkthrough.";
    return; // don't try to talk to Supabase with placeholder keys
  }

  DB.onAuth((session) => {
    state.user = session?.user || null;
    if (state.user) {
      showApp();
      loadPopular();
      refreshWatchlistIds();
    } else {
      state.watchlistIds = new Set();
      showAuthScreen();
    }
  });
}

boot();
