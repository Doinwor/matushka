/**
 * Матушка — приложение.
 * Экраны: главная («Моя волна» + артисты) и страница артиста.
 * Одна HTML-оболочка, поэтому музыка не прерывается при переходах.
 */

import {
  loadLibrary,
  escapeHtml,
  formatTime,
  gradientVars,
  initialsOf,
  pluralTracks,
} from "./data.js?v=20261029";
import { Player } from "./player.js?v=20261029";

const DEFAULT_TITLE = "Матушка — русская музыка";

const ICONS = {
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm6.8 0H17a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3.2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="currentColor"/></svg>`,
  shuffle: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arrowLeft: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19l-7-7 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.6-3.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};

const view = document.getElementById("view");
const topWave = document.getElementById("top-wave");
const toastEl = document.getElementById("toast");

const player = new Player(document.getElementById("player"));

let library = null;
let toastTimer = 0;

init();

async function init() {
  player.onStateChange = onPlayerState;
  player.onError = showToast;

  window.addEventListener("hashchange", render);
  topWave.addEventListener("click", toggleWave);
  view.addEventListener("click", onViewClick);
  view.addEventListener("input", onViewInput);
  document.addEventListener("keydown", onKeydown);

  try {
    library = await loadLibrary();
  } catch (error) {
    renderError(error.message);
    return;
  }

  render();
}

/* ============================== Роутер ============================== */

function currentRoute() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw || raw === "/") return { name: "home" };

  const artistMatch = raw.match(/^\/artist\/([^/]+)$/);
  if (artistMatch) {
    return { name: "artist", id: decodeURIComponent(artistMatch[1]) };
  }

  return { name: "notFound" };
}

function render() {
  if (!library) return;

  const route = currentRoute();
  if (route.name === "artist") {
    renderArtist(route.id);
  } else if (route.name === "home") {
    renderHome();
  } else {
    renderNotFound();
  }

  syncActive();
  updateHero();
  updateDocumentTitle();
  window.scrollTo(0, 0);
}

/* ============================== Экран: главная ============================== */

function renderHome() {
  const { artists } = library;
  const isWave = player.mode === "wave" && Boolean(player.current);
  const live = isWave && player.isPlaying;

  const cards = artists
    .map((artist) => {
      const count = artist.tracks.length;
      const meta = [artist.genre, `${count} ${pluralTracks(count)}`]
        .filter(Boolean)
        .join(" · ");

      return `
        <a class="artist-card" href="#/artist/${encodeURIComponent(artist.id)}"
           data-artist-card
           data-search="${escapeHtml(`${artist.name} ${artist.genre}`.toLowerCase())}">
          ${avatarHtml(artist)}
          <span class="artist-card__info">
            <span class="artist-card__name">${escapeHtml(artist.name)}</span>
            <span class="artist-card__meta">${escapeHtml(meta)}</span>
          </span>
          <span class="artist-card__arrow">${ICONS.chevron}</span>
        </a>`;
    })
    .join("");

  const artistsBlock = artists.length
    ? `
      <label class="search">
        ${ICONS.search}
        <input id="artist-search" type="search" placeholder="Найти артиста"
               autocomplete="off" enterkeyhint="search" aria-label="Поиск по артистам">
      </label>
      <div class="artists" id="artists-list">${cards}</div>
      <div class="no-results" id="search-empty" hidden>Никого не нашли. Попробуй другое имя.</div>`
    : `
      <div class="state-card">
        <h2>Пока пусто</h2>
        <p>Артистов ещё нет. Добавь первого в <code>data/library.json</code> —
           и он появится здесь вместе с треками.</p>
      </div>`;

  view.innerHTML = `
    <div class="screen">
      <section class="hero${live ? " is-live" : ""}" id="hero">
        <div class="hero__rings" aria-hidden="true"></div>

        <span class="hero__eyebrow">
          <span class="eq" aria-hidden="true"><span></span><span></span><span></span></span>
          <span data-wave-eyebrow>${live ? "Волна играет" : "Моя волна"}</span>
        </span>

        <h1 class="hero__title">Слушай <em>родное</em></h1>
        <p class="hero__text">Случайные треки всех артистов. Один поток — без остановки.</p>

        <button class="hero__btn" type="button" data-action="wave">
          <span class="hero__btn-icon" aria-hidden="true">
            <span class="i-play">${ICONS.play}</span>
            <span class="i-pause">${ICONS.pause}</span>
          </span>
          <span data-wave-label>${isWave ? (player.isPlaying ? "Пауза" : "Продолжить") : "Включить волну"}</span>
        </button>

        <p class="hero__now" id="wave-now"></p>
      </section>

      <section class="section">
        <div class="section__head">
          <h2>Артисты</h2>
          <span class="count">${artists.length}</span>
        </div>
        ${artistsBlock}
      </section>
    </div>`;

  updateHero();
}

/* ============================== Экран: артист ============================== */

function renderArtist(id) {
  const artist = library.artists.find((item) => item.id === id);
  if (!artist) {
    renderNotFound();
    return;
  }

  const count = artist.tracks.length;
  const meta = [
    artist.genre,
    count ? `${count} ${pluralTracks(count)}` : "нет треков",
  ]
    .filter(Boolean)
    .join(" · ");

  const rows = artist.tracks
    .map((track) => trackRow(track, artist))
    .join("");

  view.innerHTML = `
    <div class="screen">
      <a class="back" href="#/">${ICONS.arrowLeft}<span>Все артисты</span></a>

      <section class="artist-head" style="${gradientVars(artist.id)}">
        <div class="artist-head__top">
          ${avatarHtml(artist)}
          <div class="artist-head__info">
            <h1 class="artist-head__name">${escapeHtml(artist.name)}</h1>
            <div class="artist-head__meta">${escapeHtml(meta)}</div>
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
      </section>

      <div class="tracks-head">
        <h2>Треки</h2>
        <span>${count ? `${count} ${pluralTracks(count)}` : "пока нет"}</span>
      </div>

      ${
        count
          ? `<div class="tracks">${rows}</div>`
          : `<div class="state-card"><p>У артиста пока нет треков. Добавь их в
               <code>data/library.json</code>.</p></div>`
      }
    </div>`;
}

function trackRow(track, artist) {
  const sub = track.album || (track.year ? String(track.year) : "Сингл");

  return `
    <button class="track" type="button"
            data-track-id="${escapeHtml(track.id)}"
            data-artist-id="${escapeHtml(artist.id)}">
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
      <span class="track__dur">${formatTime(track.duration)}</span>
    </button>`;
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

/* ============================== Плеер и «Волна» ============================== */

function toggleWave() {
  if (!library) return;

  if (!library.allTracks.length) {
    showToast("Пока нет треков — добавь их в data/library.json");
    return;
  }

  if (player.mode === "wave" && player.current && !player.isEnded) {
    player.toggle();
  } else {
    player.startWave(library.allTracks);
  }
}

function onPlayerState() {
  document.body.classList.toggle("is-playing", player.isPlaying);
  syncActive();
  updateHero();
  updateDocumentTitle();
}

function syncActive() {
  const currentId = player.current?.id;
  view.querySelectorAll("[data-track-id]").forEach((row) => {
    const active = Boolean(currentId) && row.dataset.trackId === currentId;
    row.classList.toggle("is-active", active);
    row.setAttribute("aria-current", active ? "true" : "false");
  });
}

function updateHero() {
  const inWave = player.mode === "wave" && Boolean(player.current);
  topWave.classList.toggle("is-active", inWave);
  topWave.setAttribute("aria-pressed", String(inWave));

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

  const now = hero.querySelector("#wave-now");
  if (now) {
    now.innerHTML = inWave
      ? `Сейчас: <strong>«${escapeHtml(player.current.title)}»</strong> — ${escapeHtml(player.current.artistName)}`
      : "";
  }
}

function updateDocumentTitle() {
  const track = player.current;
  document.title = track
    ? `${player.isPlaying ? "▶ " : ""}${track.title} — ${track.artistName} · Матушка`
    : DEFAULT_TITLE;
}

/* ============================== События ============================== */

function onViewClick(event) {
  const actionEl = event.target.closest("[data-action]");
  if (actionEl) {
    const action = actionEl.dataset.action;

    if (action === "wave") {
      toggleWave();
      return;
    }

    if (action === "play-artist" || action === "shuffle-artist") {
      const artist = library?.artists.find(
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
  if (trackBtn && library) {
    const artist = library.artists.find(
      (item) => item.id === trackBtn.dataset.artistId,
    );
    const track = artist?.tracks.find(
      (item) => item.id === trackBtn.dataset.trackId,
    );
    if (artist && track) player.playTrack(track, artist);
  }
}

function onViewInput(event) {
  if (event.target.id !== "artist-search") return;

  const query = event.target.value.trim().toLowerCase();
  let visible = 0;

  view.querySelectorAll("[data-artist-card]").forEach((card) => {
    const match = (card.dataset.search || "").includes(query);
    card.hidden = !match;
    if (match) visible += 1;
  });

  const empty = document.getElementById("search-empty");
  if (empty) empty.hidden = visible > 0;
}

function onKeydown(event) {
  if (event.code !== "Space") return;
  const tag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA", "BUTTON", "A", "SELECT"].includes(tag)) return;
  if (!player.current) return;
  event.preventDefault();
  player.toggle();
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
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("is-visible");
  }, 3200);
}
