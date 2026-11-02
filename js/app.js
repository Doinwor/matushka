/**
 * Матушка — приложение.
 * Экраны: главная («Моя волна» + артисты + «Моё») и страница артиста.
 * Одна HTML-оболочка, поэтому музыка не прерывается при переходах.
 *
 * Данные по-прежнему берутся только из data/library.json — структура
 * хранения не менялась. Избранное и позиция хранятся в localStorage.
 */

import {
  loadLibrary,
  escapeHtml,
  formatTime,
  gradientVars,
  initialsOf,
  pluralTracks,
} from "./data.js?v=20261104";
import { Player } from "./player.js?v=20261104";

const DEFAULT_TITLE = "Матушка — русская музыка";
const FAV_KEY = "matushka:favorites";
const RECENT_LIMIT = 12;

const ICONS = {
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm6.8 0H17a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3.2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="currentColor"/></svg>`,
  shuffle: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arrowLeft: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19l-7-7 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.6-3.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2s-7.5-4.6-7.5-9.8A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7.5 3c0 5.2-7.5 9.8-7.5 9.8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  queue: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  dislike: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m8.4 15.6 7.2-7.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};

const view = document.getElementById("view");
const topWave = document.getElementById("top-wave");
const dockWave = document.getElementById("dock-wave");
const dockFavCount = document.getElementById("dock-fav-count");
const toastEl = document.getElementById("toast");
const liveEl = document.getElementById("live");

const player = new Player(document.getElementById("player"));

const state = {
  library: null,
  query: "",
  genre: "",
  favorites: loadFavorites(),
  scroll: new Map(),
  lastHash: "",
  recent: [],
};

let toastTimer = 0;
let searchTimer = 0;
let firstRender = true;

init();

async function init() {
  if (isIOS()) document.documentElement.classList.add("is-ios");

  player.onStateChange = onPlayerState;
  player.onError = showToast;
  player.onQueueChange = renderQueue;
  player.onToggleFavorite = () => toggleFavorite(player.current?.id);
  player.onToggleQueue = () => toggleQueuePanel();

  window.addEventListener("hashchange", render);
  topWave.addEventListener("click", toggleWave);
  dockWave?.addEventListener("click", toggleWave);
  view.addEventListener("click", onViewClick);
  view.addEventListener("input", onViewInput);
  document.addEventListener("keydown", onKeydown);
  bindQueuePanel();
  updateFavoritesBadge();

  try {
    state.library = await loadLibrary();
  } catch (error) {
    renderError(error.message);
    return;
  }

  player.restore(state.library);
  updateFavoritesBadge();
  render();
}

/* ============================== Роутер ============================== */

function currentRoute() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw || raw === "/") return { name: "home" };

  const [path, queryString] = raw.split("?");
  const params = new URLSearchParams(queryString || "");

  if (path === "/search") return { name: "search" };
  if (path === "/favorites") return { name: "favorites" };

  const artistMatch = path.match(/^\/artist\/([^/]+)$/);
  if (artistMatch) {
    return {
      name: "artist",
      id: decodeURIComponent(artistMatch[1]),
      trackId: params.get("track"),
    };
  }

  return { name: "notFound" };
}

function render() {
  if (!state.library) return;

  state.scroll.set(state.lastHash || location.hash, window.scrollY);

  const route = currentRoute();
  if (route.name === "artist") {
    renderArtist(route.id, route.trackId);
  } else if (route.name === "search") {
    renderSearch();
  } else if (route.name === "favorites") {
    renderFavoritesView();
  } else if (route.name === "home") {
    renderHome();
  } else {
    renderNotFound();
  }

  syncDock(route.name);
  syncActive();
  updateHero();
  updateDocumentTitle();
  updatePlayerChrome();

  const target = state.scroll.get(location.hash) ?? 0;
  state.lastHash = location.hash;

  if (!firstRender) focusHeading();
  firstRender = false;

  scrollToInstant(target);
}

function scrollToInstant(top) {
  try {
    window.scrollTo({ top, left: 0, behavior: "instant" });
  } catch {
    window.scrollTo(0, top);
  }
}

function focusHeading() {
  const heading = view.querySelector("h1");
  if (!heading) return;
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}

/* ============================== Экран: главная ============================== */

function renderHome() {
  const { artists, allTracks } = state.library;
  const isWave = player.mode === "wave" && Boolean(player.current);
  const live = isWave && player.isPlaying;

  const cards = artists.map(artistCardHtml).join("");

  view.innerHTML = `
    <div class="screen">
      ${noticeHtml()}

      <section class="hero${live ? " is-live" : ""}" id="hero">
        <div class="hero__content">
          <span class="hero__eyebrow">
            <span class="eq" aria-hidden="true"><span></span><span></span><span></span></span>
            <span data-wave-eyebrow>${live ? "Волна играет" : "Моя волна"}</span>
          </span>

          <h1 class="hero__title">Слушай <em>родное</em></h1>
          <p class="hero__text">Случайные треки всех артистов. Один поток — без остановки.</p>

          <div class="hero__actions">
            <button class="hero__btn" type="button" data-action="wave">
              <span class="hero__btn-icon" aria-hidden="true">
                <span class="i-play">${ICONS.play}</span>
                <span class="i-pause">${ICONS.pause}</span>
              </span>
              <span data-wave-label>${isWave ? (player.isPlaying ? "Пауза" : "Продолжить") : "Включить волну"}</span>
            </button>
            <button class="btn btn--ghost hero__dislike" type="button" data-action="dislike" hidden>
              ${ICONS.dislike}<span>Не это</span>
            </button>
            <span class="hero__hint">${allTracks.length ? "Без повторов подряд" : "Скоро здесь будет музыка"}</span>
          </div>

          <div class="hero__stats">
            ${statHtml(artists.length, pluralArtists(artists.length))}
            ${statHtml(allTracks.length, pluralTracks(allTracks.length))}
            ${statHtml(
              minutesText(allTracks.reduce((sum, track) => sum + Math.max(0, track.duration), 0)),
              "звучания",
            )}
          </div>

          <p class="hero__now" id="wave-now"></p>
        </div>

        ${collageHtml(artists)}
      </section>

      <section class="section" id="artists">
        <div class="section__head">
          <div class="section__title">
            <h2>Артисты</h2>
            <span class="count">${artists.length}</span>
          </div>
          <a class="section__link" href="#/search">
            <span>Поиск</span>${ICONS.chevron}
          </a>
        </div>

        ${
          artists.length
            ? `<div class="artists">${cards}</div>`
            : `<div class="state-card">
                 <h2>Пока пусто</h2>
                 <p>Артистов ещё нет. Добавь первого в <code>data/library.json</code> —
                    и он появится здесь вместе с треками.</p>
               </div>`
        }
      </section>
    </div>`;

  updateHero();
}

/** Карточка артиста — общая для главной и поиска. */
function artistCardHtml(artist) {
  const count = artist.tracks.length;
  const meta = `${count} ${pluralTracks(count)} · ${minutesText(
    artist.tracks.reduce((sum, track) => sum + Math.max(0, track.duration), 0),
  )}`;
  const genre = artist.genre
    ? `<span class="artist-card__badge">${escapeHtml(artist.genre)}</span>`
    : "";
  const haystack = `${artist.name} ${artist.genre} ${artist.tracks
    .map((track) => track.title)
    .join(" ")}`;

  return `
    <a class="artist-card" href="#/artist/${encodeURIComponent(artist.id)}"
       data-artist-card
       data-genre="${escapeHtml(artist.genre || "")}"
       data-search="${escapeHtml(normalize(haystack))}">
      <span class="artist-card__media" style="${gradientVars(artist.id)}">
        <span class="artist-card__initials" aria-hidden="true">${escapeHtml(initialsOf(artist.name))}</span>
        ${imageHtml("artist-card__img", artist.photo)}
        ${genre}
        <span class="artist-card__play" aria-hidden="true">${ICONS.play}</span>
      </span>
      <span class="artist-card__name">${escapeHtml(artist.name)}</span>
      <span class="artist-card__meta">${escapeHtml(meta)}</span>
    </a>`;
}

function statHtml(value, label) {
  return `<span class="hero__stat"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></span>`;
}

/** Коллаж из фотографий артистов в шапке главной. */
function collageHtml(artists) {
  const shots = artists.filter((artist) => artist.photo).slice(0, 4);
  if (!shots.length) return "";

  return `
    <div class="hero__collage" aria-hidden="true">
      ${shots
        .map(
          (artist) => `
        <span class="hero__shot" style="${gradientVars(artist.id)}">
          <img src="${escapeHtml(artist.photo)}" alt="" decoding="async"
               fetchpriority="high" onerror="this.remove()">
        </span>`,
        )
        .join("")}
    </div>`;
}

/* ============================== Экран: артист ============================== */

function renderArtist(id, trackId) {
  const artist = state.library.artists.find((item) => item.id === id);
  if (!artist) {
    renderNotFound();
    return;
  }

  const count = artist.tracks.length;
  const seconds = artist.tracks.reduce(
    (sum, track) => sum + Math.max(0, track.duration),
    0,
  );

  const rows = artist.tracks
    .map((track, index) => trackRow(track, artist, index))
    .join("");

  const chips = [
    artist.genre ? `<span class="chip chip--accent">${escapeHtml(artist.genre)}</span>` : "",
    `<span class="chip">${count} ${pluralTracks(count)}</span>`,
    count ? `<span class="chip">${minutesText(seconds)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  const photoStyle = artist.photo
    ? `background-image:${cssUrl(artist.photo)}`
    : "";

  view.innerHTML = `
    <div class="screen">
      <a class="back" href="#/">${ICONS.arrowLeft}<span>Все артисты</span></a>

      <section class="artist-head" style="${gradientVars(artist.id)}">
        <div class="artist-head__bg" aria-hidden="true" style="${photoStyle}"></div>

        <div class="artist-head__inner">
          <div class="artist-head__top">
            ${avatarHtml(artist)}
            <div class="artist-head__info">
              <h1 class="artist-head__name">${escapeHtml(artist.name)}</h1>
              <div class="artist-head__chips">${chips}</div>
            </div>
          </div>

          ${artist.bio ? `<p class="artist-head__bio">${escapeHtml(artist.bio)}</p>` : ""}

          <div class="artist-actions">
            <button class="btn btn--primary" type="button"
                    data-action="play-artist" data-artist="${escapeHtml(artist.id)}"
                    ${count ? "" : "disabled"}>
              ${ICONS.play}<span>Слушать всё</span>
            </button>
            <button class="btn btn--ghost" type="button"
                    data-action="shuffle-artist" data-artist="${escapeHtml(artist.id)}"
                    ${count ? "" : "disabled"}>
              ${ICONS.shuffle}<span>Вперемешку</span>
            </button>
          </div>
        </div>
      </section>

      <div class="tracks-head">
        <h2>Треки</h2>
        <span>${count ? `${count} ${pluralTracks(count)}` : "пока нет"}</span>
      </div>

      ${
        count
          ? `<div class="tracks">
               <div class="tracks__labels" aria-hidden="true">
                 <span>№</span><span></span><span>Трек</span><span>Альбом</span><span>Время</span>
               </div>
               ${rows}
             </div>`
          : `<div class="state-card"><p>У артиста пока нет треков. Добавь их в
               <code>data/library.json</code>.</p></div>`
      }
    </div>`;

  updateFavoritesUI();

  if (trackId) highlightTrack(trackId);
}

/** Подсветка трека из прямой ссылки «…#/artist/id?track=id». */
function highlightTrack(trackId) {
  const row = [...view.querySelectorAll("[data-track-id]")].find(
    (element) => element.dataset.trackId === trackId,
  );
  if (!row) return;

  row.classList.add("is-linked");
  window.requestAnimationFrame(() => {
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.querySelector(".track__hit")?.focus({ preventScroll: true });
  });
}

/**
 * Редактируемый блок на главной: заголовок и текст меняются из программы «Матушка».
 * Пустой или выключенный блок на странице не показывается.
 */
function noticeHtml() {
  const site = state.library.site || {};
  if (site.noticeEnabled === false) return "";

  const title = String(site.noticeTitle || "").trim();
  const text = String(site.noticeText || "").trim();
  if (!title && !text) return "";

  return `
    <section class="notice">
      <span class="notice__flag" aria-hidden="true"></span>
      <div class="notice__body">
        ${title ? `<h2 class="notice__title">${escapeHtml(title)}</h2>` : ""}
        ${text ? `<p class="notice__text">${escapeHtml(text)}</p>` : ""}
      </div>
    </section>`;
}

function trackRow(track, artist, index) {
  const sub = track.album || (track.year ? String(track.year) : "Сингл");
  const album = track.album || "—";
  const isFav = state.favorites.has(track.id);

  return `
    <div class="track" data-track-id="${escapeHtml(track.id)}"
         data-artist-id="${escapeHtml(artist.id)}">
      <button class="track__hit" type="button"
              aria-label="Играть: ${escapeHtml(track.title)} — ${escapeHtml(artist.name)}"></button>
      <span class="track__index" aria-hidden="true">
        <span class="track__num">${String(index + 1).padStart(2, "0")}</span>
        <span class="track__play">${ICONS.play}</span>
        <span class="track__eq"><span class="eq"><span></span><span></span><span></span></span></span>
      </span>
      <span class="track__cover" style="${gradientVars(track.id)}">
        <span class="track__cover-letter" aria-hidden="true">${escapeHtml(initialsOf(track.title))}</span>
        ${imageHtml("track__cover-img", track.cover)}
        <span class="track__playing" aria-hidden="true">
          <span class="eq"><span></span><span></span><span></span></span>
        </span>
      </span>
      <span class="track__main">
        <span class="track__title">${escapeHtml(track.title)}</span>
        <span class="track__sub">${escapeHtml(sub)}</span>
      </span>
      <span class="track__album">${escapeHtml(album)}</span>
      <span class="track__side">
        <span class="track__dur">${formatTime(track.duration)}</span>
        <button class="track__fav" type="button" data-fav="${escapeHtml(track.id)}"
                aria-pressed="${isFav}" aria-label="${isFav ? "Убрать из избранного" : "В избранное"}">
          ${ICONS.heart}
        </button>
      </span>
    </div>`;
}

function avatarHtml(artist) {
  const style = gradientVars(artist.id);
  return `
    <span class="avatar" style="${style}">
      <span class="avatar__letters" aria-hidden="true">${escapeHtml(initialsOf(artist.name))}</span>
      ${imageHtml("avatar__img", artist.photo)}
    </span>`;
}

/**
 * Картинка поверх градиентной заглушки.
 * Если файла нет или он не открылся — картинка убирается, остаются буквы.
 */
function imageHtml(className, src) {
  if (!src) return "";
  return `<img class="${className}" src="${escapeHtml(src)}" alt=""
               loading="lazy" decoding="async" onerror="this.remove()">`;
}

function cssUrl(path) {
  return `url('${String(path).replaceAll("'", "%27")}')`;
}

/* ============================== Поиск, жанры, избранное ============================== */

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("ё", "е");
}

/* ============================== Экран: поиск ============================== */

function renderSearch() {
  const { artists } = state.library;
  const genres = [
    ...new Set(artists.map((artist) => artist.genre).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "ru"));

  // Выбранный жанр мог исчезнуть вместе с артистом — сбрасываем фильтр.
  if (state.genre && !genres.includes(state.genre)) state.genre = "";

  const cards = artists.map(artistCardHtml).join("");

  view.innerHTML = `
    <div class="screen">
      <header class="page-head">
        <span class="page-head__eyebrow">${ICONS.search}<span>Поиск</span></span>
        <h1 class="page-head__title">Найти <em>своё</em></h1>
        <p class="page-head__text">Артисты, треки и альбомы. Начни вводить — покажем совпадения.</p>
      </header>

      <div class="search-wrap">
        <label class="search search--lg">
          ${ICONS.search}
          <input id="artist-search" type="search" placeholder="Артист, трек или альбом"
                 autocomplete="off" enterkeyhint="search" aria-label="Поиск по артистам и трекам"
                 value="${escapeHtml(state.query)}">
          <button class="search__clear" type="button" data-action="clear-search"
                  aria-label="Очистить поиск" ${state.query ? "" : "hidden"}>
            ${ICONS.close}
          </button>
        </label>
        ${chipsHtml(genres)}
      </div>

      <div class="search-tracks" id="search-tracks" hidden></div>

      <section class="section section--flat">
        <div class="section__head">
          <div class="section__title">
            <h2>Артисты</h2>
            <span class="count" id="artists-count">${artists.length}</span>
          </div>
          <span class="section__note">По имени и трекам</span>
        </div>
        <div class="artists" id="artists-list">${cards}</div>
        <div class="no-results" id="search-empty" hidden>Никого не нашли. Попробуй другое имя.</div>
      </section>
    </div>`;

  applyFilters();
  updateFavoritesUI();
}

function chipsHtml(genres) {
  if (genres.length <= 1) return "";

  return `
    <div class="chips" role="group" aria-label="Жанры">
      <button class="genre-chip${state.genre ? "" : " is-active"}" type="button"
              data-genre="" aria-pressed="${state.genre ? "false" : "true"}">Все</button>
      ${genres
        .map(
          (genre) => `
        <button class="genre-chip${state.genre === genre ? " is-active" : ""}" type="button"
                data-genre="${escapeHtml(genre)}"
                aria-pressed="${state.genre === genre}">${escapeHtml(genre)}</button>`,
        )
        .join("")}
    </div>`;
}

function applyFilters() {
  if (!state.library) return;

  const query = normalize(state.query);
  let visible = 0;

  view.querySelectorAll("[data-artist-card]").forEach((card) => {
    const byQuery = !query || (card.dataset.search || "").includes(query);
    const byGenre = !state.genre || card.dataset.genre === state.genre;
    const match = byQuery && byGenre;
    card.hidden = !match;
    if (match) visible += 1;
  });

  const count = document.getElementById("artists-count");
  if (count) count.textContent = String(visible);

  const empty = document.getElementById("search-empty");
  if (empty) {
    empty.hidden = !(visible === 0 && Boolean(query || state.genre));
    empty.textContent = state.genre && !query
      ? "В этом жанре пока никого нет."
      : "Никого не нашли. Попробуй другое имя.";
  }

  updateChips();
  renderSearchTracks(query);
}

function updateChips() {
  view.querySelectorAll(".genre-chip[data-genre]").forEach((chip) => {
    const active = (chip.dataset.genre || "") === state.genre;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", String(active));
  });
}

function renderSearchTracks(query) {
  const box = document.getElementById("search-tracks");
  if (!box) return;

  if (!query) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }

  const found = [];
  for (const artist of state.library.artists) {
    if (state.genre && artist.genre !== state.genre) continue;
    for (const track of artist.tracks) {
      const haystack = normalize(`${track.title} ${artist.name} ${track.album || ""}`);
      if (haystack.includes(query)) found.push({ track, artist });
    }
  }

  if (!found.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }

  box.hidden = false;
  box.innerHTML = `
    <div class="search-tracks__head">
      <span>Треки</span><span class="count">${found.length}</span>
    </div>
    <div class="tracks">
      ${found
        .slice(0, 20)
        .map(({ track, artist }, index) => trackRow(track, artist, index))
        .join("")}
    </div>`;

  syncActive();
  updateFavoritesUI();
}

function loadFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...state.favorites]));
  } catch {
    /* приватный режим */
  }
}

function favoritesItems() {
  const items = [];
  if (!state.library) return items;

  for (const artist of state.library.artists) {
    for (const track of artist.tracks) {
      if (state.favorites.has(track.id)) items.push({ track, artist });
    }
  }

  return items;
}

function updateFavoritesBadge() {
  if (!dockFavCount) return;
  const count = state.favorites.size;
  dockFavCount.textContent = count > 99 ? "99+" : String(count);
  dockFavCount.hidden = count === 0;
}

function toggleFavorite(id) {
  if (!id) return;

  if (state.favorites.has(id)) {
    state.favorites.delete(id);
    showToast("Убрали из избранного");
  } else {
    state.favorites.add(id);
    showToast("Добавили в избранное");
  }

  saveFavorites();
  updateFavoritesUI();
  updateFavoritesBadge();
  if (currentRoute().name === "favorites") renderFavoritesView();
  player.setFavorite(Boolean(player.current) && state.favorites.has(player.current.id));
}

function updateFavoritesUI() {
  view.querySelectorAll("[data-fav]").forEach((button) => {
    const active = state.favorites.has(button.dataset.fav);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active ? "Убрать из избранного" : "В избранное");
  });
}

function renderFavorites() {
  const list = document.getElementById("favorites-list");
  if (!list || !state.library) return;

  const items = favoritesItems();
  list.innerHTML = items
    .map(({ track, artist }, index) => trackRow(track, artist, index))
    .join("");

  const count = document.getElementById("favorites-count");
  if (count) count.textContent = String(items.length);

  syncActive();
  updateFavoritesUI();
  updateFavoritesBadge();
}

function renderFavoritesView() {
  if (!state.library) return;

  const items = favoritesItems();
  const seconds = items.reduce(
    (sum, { track }) => sum + Math.max(0, track.duration),
    0,
  );
  const hasItems = items.length > 0;

  view.innerHTML = `
    <div class="screen">
      <header class="page-head">
        <span class="page-head__eyebrow page-head__eyebrow--red">
          ${ICONS.heart}<span>Коллекция</span>
        </span>
        <h1 class="page-head__title">Моё <em>избранное</em></h1>
        <p class="page-head__text">Треки, которые ты отметил сердечком. Хранятся на этом устройстве.</p>
      </header>

      <section class="collection" aria-label="Избранное">
        <div class="collection__art" aria-hidden="true">
          <span class="collection__heart">${ICONS.heart}</span>
        </div>
        <div class="collection__body">
          <span class="collection__label">Плейлист</span>
          <h2 class="collection__title">Избранное</h2>
          <p class="collection__meta">
            <span id="favorites-count">${items.length}</span>
            <span>${pluralTracks(items.length)}</span>
            ${hasItems ? `<span class="collection__dot">·</span><span>${minutesText(seconds)}</span>` : ""}
          </p>
          <div class="collection__actions">
            <button class="btn btn--primary" type="button" data-action="play-favorites"
                    ${hasItems ? "" : "disabled"}>
              ${ICONS.play}<span>Слушать</span>
            </button>
            <button class="btn btn--ghost" type="button" data-action="shuffle-favorites"
                    ${hasItems ? "" : "disabled"}>
              ${ICONS.shuffle}<span>Вперемешку</span>
            </button>
          </div>
        </div>
      </section>

      ${
        hasItems
          ? `<div class="tracks-head">
               <h2>Треки</h2>
               <span>${items.length} ${pluralTracks(items.length)}</span>
             </div>
             <div class="tracks" id="favorites-list"></div>`
          : `<div class="favorites-empty" id="favorites-empty">
               <span class="favorites-empty__icon" aria-hidden="true">${ICONS.heart}</span>
               <h2>Пока пусто</h2>
               <p>Нажми сердечко у любого трека — и он появится здесь.
                  Избранное хранится только на этом устройстве.</p>
               <div class="favorites-empty__actions">
                 <a class="btn btn--primary" href="#/search">${ICONS.search}<span>Найти треки</span></a>
                 <a class="btn btn--ghost" href="#/">На главную</a>
               </div>
             </div>`
      }
    </div>`;

  renderFavorites();
  updateFavoritesUI();
}

/* ============================== Очередь ============================== */

function bindQueuePanel() {
  const panel = document.getElementById("queue");
  if (!panel) return;

  panel.addEventListener("click", (event) => {
    if (event.target.closest("#queue-close")) {
      toggleQueuePanel(false);
      return;
    }

    const remove = event.target.closest("[data-queue-remove]");
    if (remove) {
      player.removeAt(Number(remove.dataset.queueRemove));
      return;
    }

    const play = event.target.closest("[data-queue-index]");
    if (play) player.jumpTo(Number(play.dataset.queueIndex));
  });
}

function toggleQueuePanel(force) {
  const panel = document.getElementById("queue");
  if (!panel) return;

  const open = typeof force === "boolean" ? force : panel.hidden;
  panel.hidden = !open;

  document.getElementById("queue-btn")?.setAttribute("aria-expanded", String(open));
  if (open) renderQueue();
}

function renderQueue() {
  const panel = document.getElementById("queue");
  if (!panel || panel.hidden) return;

  const list = document.getElementById("queue-list");
  if (!list) return;

  const mode = document.getElementById("queue-mode");
  if (mode) {
    mode.textContent =
      player.mode === "wave"
        ? "Моя волна"
        : player.mode === "collection"
          ? "Избранное"
          : "Артист";
  }

  if (!player.queue.length) {
    list.innerHTML = `<li class="queue__empty">Очередь пуста</li>`;
    return;
  }

  list.innerHTML = player.queue
    .map(
      (track, index) => `
      <li class="queue__item${index === player.index ? " is-active" : ""}">
        <button class="queue__play" type="button" data-queue-index="${index}">
          <span class="queue__num">${String(index + 1).padStart(2, "0")}</span>
          <span class="queue__text">
            <span class="queue__title">${escapeHtml(track.title)}</span>
            <span class="queue__artist">${escapeHtml(track.artistName)}</span>
          </span>
          <span class="queue__dur">${formatTime(track.duration)}</span>
        </button>
        <button class="queue__remove" type="button" data-queue-remove="${index}"
                aria-label="Убрать «${escapeHtml(track.title)}» из очереди">×</button>
      </li>`,
    )
    .join("");

  const active = list.querySelector(".queue__item.is-active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

/* ============================== Плеер и «Волна» ============================== */

function wavePool() {
  if (!state.genre) return state.library.allTracks;
  return state.library.allTracks.filter(
    (track) => artistById(track.artistId)?.genre === state.genre,
  );
}

function artistById(id) {
  return state.library?.artists.find((artist) => artist.id === id) || null;
}

function toggleWave() {
  if (!state.library) return;

  const pool = wavePool();
  if (!pool.length) {
    showToast(
      state.genre
        ? `В жанре «${state.genre}» пока нет треков`
        : "Пока нет треков — добавь их в data/library.json",
    );
    return;
  }

  if (player.mode === "wave" && player.current && !player.isEnded) {
    player.toggle();
  } else {
    player.startWave(pool, { recentIds: state.recent.slice(-6) });
  }
}

function dislikeCurrent() {
  const track = player.current;
  if (!track) return;

  if (player.mode !== "wave") {
    showToast("«Не это» работает в «Моей волне»");
    return;
  }

  player.dislike();
  showToast(`${track.artistName} — реже в волне`);
}

function onPlayerState() {
  document.body.classList.toggle("is-playing", player.isPlaying);

  const current = player.current;
  if (current) {
    state.recent.push(current.id);
    if (state.recent.length > RECENT_LIMIT) state.recent.shift();

    if (liveEl) {
      liveEl.textContent = `Играет: ${current.title} — ${current.artistName}`;
    }
  }

  syncActive();
  updateHero();
  updateDocumentTitle();
  updatePlayerChrome();
  renderQueue();
}

function updatePlayerChrome() {
  const track = player.current;
  player.setFavorite(Boolean(track) && state.favorites.has(track.id));

  const queueBtn = document.getElementById("queue-btn");
  if (queueBtn) queueBtn.hidden = !track;
}

function syncDock(routeName) {
  const active = routeName === "artist" ? "home" : routeName;
  document.querySelectorAll("[data-dock]").forEach((item) => {
    const on = item.dataset.dock === active;
    item.classList.toggle("is-active", on);
    if (on) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
}

function syncActive() {
  const currentId = player.current?.id;
  view.querySelectorAll("[data-track-id]").forEach((row) => {
    const active = Boolean(currentId) && row.dataset.trackId === currentId;
    row.classList.toggle("is-active", active);
    if (active) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
  });
}

function updateHero() {
  const inWave = player.mode === "wave" && Boolean(player.current);
  topWave.classList.toggle("is-active", inWave);
  topWave.setAttribute("aria-pressed", String(inWave));

  if (dockWave) {
    dockWave.classList.toggle("is-active", inWave);
    dockWave.setAttribute("aria-pressed", String(inWave));
  }

  const hero = document.getElementById("hero");
  if (!hero) return;

  const live = inWave && player.isPlaying;
  hero.classList.toggle("is-live", live);

  const eyebrow = hero.querySelector("[data-wave-eyebrow]");
  if (eyebrow) eyebrow.textContent = live ? "Волна играет" : "Моя волна";

  const label = hero.querySelector("[data-wave-label]");
  if (label) {
    label.textContent = inWave
      ? player.isPlaying
        ? "Пауза"
        : "Продолжить"
      : "Включить волну";
  }

  const dislike = hero.querySelector("[data-action='dislike']");
  if (dislike) dislike.hidden = !inWave;

  const now = hero.querySelector("#wave-now");
  if (now) {
    now.innerHTML = inWave
      ? `Сейчас: <strong>«${escapeHtml(player.current.title)}»</strong> — ${escapeHtml(player.current.artistName)}`
      : "";
  }
}

function updateDocumentTitle() {
  const track = player.current;
  if (track) {
    document.title = `${player.isPlaying ? "▶ " : ""}${track.title} — ${track.artistName} · Матушка`;
    return;
  }

  const route = currentRoute();
  if (route.name === "search") {
    document.title = "Поиск — Матушка";
  } else if (route.name === "favorites") {
    document.title = "Избранное — Матушка";
  } else if (route.name === "artist") {
    const artist = artistById(route.id);
    document.title = artist ? `${artist.name} — Матушка` : DEFAULT_TITLE;
  } else {
    document.title = DEFAULT_TITLE;
  }
}

/* ============================== События ============================== */

function onViewClick(event) {
  const favButton = event.target.closest("[data-fav]");
  if (favButton) {
    event.preventDefault();
    toggleFavorite(favButton.dataset.fav);
    return;
  }

  const genreChip = event.target.closest(".genre-chip[data-genre]");
  if (genreChip) {
    state.genre = genreChip.dataset.genre || "";
    applyFilters();
    return;
  }

  const actionEl = event.target.closest("[data-action]");
  if (actionEl) {
    const action = actionEl.dataset.action;

    if (action === "wave") {
      toggleWave();
      return;
    }

    if (action === "clear-search") {
      event.preventDefault();
      state.query = "";
      const input = document.getElementById("artist-search");
      if (input) input.value = "";
      updateSearchClear();
      applyFilters();
      input?.focus();
      return;
    }

    if (action === "play-favorites" || action === "shuffle-favorites") {
      const tracks = favoritesItems().map(({ track }) => track);
      if (!tracks.length) {
        showToast("В избранном пока пусто");
        return;
      }
      player.playCollection(tracks, {
        shuffled: action === "shuffle-favorites",
        mode: "collection",
      });
      return;
    }

    if (action === "dislike") {
      dislikeCurrent();
      return;
    }

    if (action === "play-artist" || action === "shuffle-artist") {
      const artist = state.library?.artists.find(
        (item) => item.id === actionEl.dataset.artist,
      );
      if (artist) {
        player.playArtist(artist, { shuffled: action === "shuffle-artist" });
      }
      return;
    }

    if (action === "reload") {
      location.reload();
      return;
    }
  }

  const trackBtn = event.target.closest("[data-track-id]");
  if (trackBtn && state.library) {
    const artist = state.library.artists.find(
      (item) => item.id === trackBtn.dataset.artistId,
    );
    const track = artist?.tracks.find(
      (item) => item.id === trackBtn.dataset.trackId,
    );
    if (artist && track) {
      player.playTrack(track, artist);
      linkTrack(track, artist);
    }
  }
}

/** Держит адрес в актуальном виде: #/artist/id?track=id. */
function linkTrack(track, artist) {
  const route = currentRoute();
  if (route.name !== "artist" || route.id !== artist.id) return;

  try {
    history.replaceState(
      null,
      "",
      `#/artist/${encodeURIComponent(artist.id)}?track=${encodeURIComponent(track.id)}`,
    );
  } catch {
    /* ignore */
  }
}

function onViewInput(event) {
  if (event.target.id !== "artist-search") return;

  state.query = event.target.value;
  updateSearchClear();
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(applyFilters, 120);
}

function updateSearchClear() {
  const button = view.querySelector(".search__clear");
  if (!button) return;
  button.hidden = !state.query;
}

function onKeydown(event) {
  const target = event.target;
  const tag = target?.tagName;
  const typing =
    ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || target?.isContentEditable;

  if (event.code === "Space") {
    if (typing || ["BUTTON", "A"].includes(tag)) return;
    if (!player.current) return;
    event.preventDefault();
    player.toggle();
    return;
  }

  if (typing) return;

  if (event.key === "ArrowRight") {
    if (!player.current) return;
    event.preventDefault();
    player.seekBy(5);
  } else if (event.key === "ArrowLeft") {
    if (!player.current) return;
    event.preventDefault();
    player.seekBy(-5);
  } else if (event.key === "m" || event.key === "M" || event.key === "ь") {
    if (!player.current) return;
    player.toggleMute();
  } else if (event.key === "n" || event.key === "N" || event.key === "т") {
    if (!player.current) return;
    player.next();
  } else if (event.key === "p" || event.key === "P" || event.key === "з") {
    if (!player.current) return;
    player.prev();
  }
}

function isIOS() {
  const ua = navigator.userAgent || "";
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/* ============================== Служебные экраны ============================== */

function renderError(message) {
  document.title = DEFAULT_TITLE;
  view.innerHTML = `
    <div class="screen">
      <div class="state-card" style="margin-top:32px">
        <h2>Не удалось открыть сайт</h2>
        <p>${escapeHtml(message)}</p>
        <p>Проверь, что файл <code>data/library.json</code> на месте и в нём нет
           ошибки в JSON. Затем обнови страницу.</p>
        <button class="btn btn--primary" type="button" data-action="reload">Обновить</button>
      </div>
    </div>`;
}

function renderNotFound() {
  view.innerHTML = `
    <div class="screen">
      <div class="state-card" style="margin-top:32px">
        <h2>Такой страницы нет</h2>
        <p>Возможно, ссылка устарела или артист был переименован.</p>
        <a class="btn btn--primary" href="#/">На главную</a>
      </div>
    </div>`;
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("is-visible");
  }, 3200);
}

/* ============================== Текст ============================== */

function pluralArtists(n) {
  return pluralRu(n, "артист", "артиста", "артистов");
}

function pluralRu(n, one, few, many) {
  const count = Math.abs(Number(n) || 0) % 100;
  const last = count % 10;
  if (count > 10 && count < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** 0 → «—», 90 → «2 мин», 5400 → «1 ч 30 мин». */
function minutesText(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total <= 0) return "—";
  if (total < 60) return `${total} сек`;

  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}
