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
  mode: "popular", // popular | search | mine | watch | activity
  query: "",
  page: 1,
  totalPages: 1,
  loading: false,
  watchlistIds: new Set(),
  myProfile: null,
  topMovieIds: new Set(),
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

// =====================================================
//  DEVICE MODE (mobile vs desktop layout)
// =====================================================
function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 720;
}

// Mobile layout when the viewport is narrow OR the user explicitly chose mobile.
function applyDeviceMode() {
  const choice = localStorage.getItem("cinerate_device");
  const mobile = window.innerWidth <= 720 || choice === "mobile";
  document.body.classList.toggle("device-mobile", mobile);
  document.body.classList.toggle("device-desktop", !mobile);
  const vt = $("#viewToggle");
  if (vt) vt.textContent = mobile ? "🖥 Desktop view" : "📱 Mobile view";
}

function chooseDevice(device) {
  localStorage.setItem("cinerate_device", device);
  applyDeviceMode();
  $("#deviceScreen").classList.add("hidden");
}

function setupDevice() {
  applyDeviceMode();
  window.addEventListener("resize", applyDeviceMode);

  document.querySelectorAll(".device-opt").forEach((opt) =>
    opt.addEventListener("click", () => chooseDevice(opt.dataset.device))
  );

  // Show the welcome screen only on the very first visit.
  if (!localStorage.getItem("cinerate_device")) {
    const detected = isMobileDevice() ? "recMobile" : "recDesktop";
    $("#" + detected).textContent = "Recommended for you";
    $("#deviceScreen").classList.remove("hidden");
  }

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
  });

  // Switch layout from the menu
  $("#viewToggle").addEventListener("click", () => {
    const nowMobile = document.body.classList.contains("device-mobile");
    chooseDevice(nowMobile ? "desktop" : "mobile");
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
  $("#avatarInput").addEventListener("change", onAvatarPicked);
  $("#activityBtn").addEventListener("click", () => loadActivity("all"));
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
  if (page === 1) clearPeople();
  $("#sectionTitle").textContent = "Popular right now";
  await runLoad(() => TMDB.getPopular(page), page === 1);
}

async function loadSearch(query, page = 1) {
  state.mode = "search";
  state.query = query;
  state.page = page;
  $("#sectionTitle").textContent = `Results for “${query}”`;
  await runLoad(() => TMDB.searchMovies(query, page), page === 1);
  if (page === 1) renderPeopleResults(query); // people above the movie grid
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
  showBrowse();
  clearPeople();
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
  item.addEventListener("click", () => openMovie(r.movie_id));
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
  $("#loadMore").classList.add("hidden");
  $("#sectionTitle").innerHTML = `Activity
    <span class="scope-toggle">
      <button class="scope-btn ${scope === "all" ? "active" : ""}" data-scope="all">Everyone</button>
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
    const rows =
      scope === "mine"
        ? await DB.getUserRatings(state.user.id)
        : await DB.getRecentActivity(40);
    if (!rows.length) {
      $("#gridStatus").textContent =
        scope === "mine"
          ? "You haven't rated anything yet."
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
}

function avatarHTML(profile, name, cls = "") {
  return profile?.avatar_url
    ? `<img class="avatar-img ${cls}" src="${esc(profile.avatar_url)}" alt="${esc(name)}" />`
    : `<div class="avatar-img ${cls} placeholder">${esc((name || "?").slice(0, 1).toUpperCase())}</div>`;
}

function top5Card(mv, i, isSelf) {
  const poster = mv.poster
    ? `<img class="poster" loading="lazy" src="${TMDB.IMG}${mv.poster}" alt="${esc(mv.title)}" />`
    : `<div class="poster placeholder">${esc(mv.title)}</div>`;
  return `<div class="top5-card" data-mid="${mv.id}">
    <span class="top5-rank">${i + 1}</span>
    ${isSelf ? `<button class="top5-remove" data-id="${mv.id}" title="Remove">✕</button>` : ""}
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
    const [profile, counts, following] = await Promise.all([
      DB.getProfile(userId),
      DB.getFollowCounts(userId),
      isSelf ? Promise.resolve(false) : DB.isFollowing(state.user.id, userId),
    ]);
    renderProfile(userId, profile, counts, following, isSelf);
    if (isSelf) {
      loadIncomingRecs(userId);
      markRecsSeen();
    }
  } catch (err) {
    view.innerHTML = `<div class="grid-status">⚠️ ${esc(err.message)}</div>`;
  }
}

function recCard(r) {
  const poster = r.movie_poster
    ? `<img class="poster" loading="lazy" src="${TMDB.IMG}${r.movie_poster}" alt="${esc(r.movie_title)}" />`
    : `<div class="poster placeholder">${esc(r.movie_title)}</div>`;
  return `<div class="rec-card" data-mid="${r.movie_id}" data-id="${r.id}">
    <button class="rec-dismiss" title="Dismiss">✕</button>
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
    $("#navToggle").classList.toggle("has-badge", n > 0);
  } catch {
    /* recommendations table may not exist yet */
  }
}

function markRecsSeen() {
  localStorage.setItem("cinerate_recs_seen", new Date().toISOString());
  $("#recBadge")?.classList.add("hidden");
  $("#navToggle")?.classList.remove("has-badge");
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
      c.addEventListener("click", () => openMovie(Number(c.dataset.mid)));
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

function renderProfile(userId, profile, counts, following, isSelf) {
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
    c.addEventListener("click", () => openMovie(Number(c.dataset.mid)))
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
        const m = {
          id: r.movie_id,
          title: r.movie_title,
          poster_path: r.movie_poster,
          release_date: r.movie_year || "",
          vote_average: null,
        };
        const card = movieCard(m);
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
  const userId = params.get("user");
  if (movieId) openMovie(Number(movieId));
  else if (userId) openProfile(userId);
}

// =====================================================
//  MOVIE DETAIL MODAL
// =====================================================
let modalState = { movie: null, myRating: 0, myMode: "simple", myAspects: emptyAspects(), ratings: [] };

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
            movie,
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

  const crew = m.credits?.crew || [];
  const cast = m.credits?.cast || [];
  const directors = crew.filter((c) => c.job === "Director").map((c) => c.name);
  const castCard = (c) => {
    const photo = c.profile_path
      ? `<img class="cast-photo" loading="lazy" src="${TMDB.IMG_PROFILE}${c.profile_path}" alt="${esc(c.name)}" />`
      : `<div class="cast-photo placeholder">${esc(c.name.slice(0, 1))}</div>`;
    return `<div class="cast-card">
      ${photo}
      <div class="cast-name">${esc(c.name)}</div>
      <div class="cast-char">${esc(c.character || "")}</div>
    </div>`;
  };

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
        ${directors.length ? `<div class="detail-director">🎬 Directed by <b>${directors.map(esc).join(", ")}</b></div>` : ""}
        <p class="detail-overview">${esc(m.overview || "No synopsis available.")}</p>
        <div class="detail-actions">
          <button class="btn btn-watch" id="watchToggle"></button>
          <button class="btn btn-watch" id="top5Toggle"></button>
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

    <div class="rate-box">
      <div class="rate-head">
        <h3>${myExisting ? "Your rating" : "Rate this movie"}</h3>
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
  $("#watchToggle").addEventListener("click", toggleWatch);
  $("#top5Toggle").addEventListener("click", toggleTop5);
  $("#shareMovie").addEventListener("click", (e) =>
    shareLink(shareBase() + "?movie=" + modalState.movie.id, e.currentTarget)
  );
  $("#recommendMovie").addEventListener("click", () => openRecommendPicker(modalState.movie));
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

function updateTop5Btn() {
  const btn = $("#top5Toggle");
  if (!btn) return;
  const inTop = state.topMovieIds.has(modalState.movie.id);
  const full = state.topMovieIds.size >= 5 && !inTop;
  btn.textContent = inTop ? "★ In your Top 5" : full ? "Top 5 full" : "＋ Add to Top 5";
  btn.classList.toggle("active", inTop);
  btn.disabled = full;
}

async function toggleTop5() {
  const m = modalState.movie;
  const inTop = state.topMovieIds.has(m.id);
  let top = Array.isArray(state.myProfile?.top_movies) ? [...state.myProfile.top_movies] : [];
  if (inTop) {
    top = top.filter((x) => x.id !== m.id);
  } else {
    if (top.length >= 5) return;
    top.push({
      id: m.id,
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
    movie: modalState.movie,
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
  modalState.myMode = "simple";
  modalState.myAspects = emptyAspects();
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

  DB.onAuth((session) => {
    state.user = session?.user || null;
    if (state.user) {
      showApp();
      loadPopular();
      refreshWatchlistIds();
      loadMyProfileState();
      refreshRecBadge();
      applyDeepLink();
    } else {
      state.watchlistIds = new Set();
      state.myProfile = null;
      state.topMovieIds = new Set();
      showAuthScreen();
    }
  });
}

boot();
