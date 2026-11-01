/**
 * Плеер «Матушка».
 * Живёт вне экранов: переходы по сайту не прерывают музыку.
 * На телефоне открывается на весь экран, на ПК — плавающей панелью
 * (по клику на обложку — карточкой по центру).
 */

import { formatTime, gradientVars, initialsOf, shuffle } from "./data.js?v=20261102";

const VOLUME_KEY = "matushka:volume";
const LAST_KEY = "matushka:last";
const MOBILE_QUERY = "(max-width: 899px)";

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим */
  }
}

/**
 * Перемешивает треки так, чтобы один артист не шёл несколько раз подряд.
 * `recentIds` — что недавно звучало, `blockedArtists` — кого реже показывать.
 */
export function smartShuffle(tracks, { recentIds = [], blockedArtists = new Set() } = {}) {
  if (!tracks.length) return [];

  const fresh = tracks.filter((track) => !recentIds.includes(track.id));
  const base = fresh.length >= Math.min(6, tracks.length) ? fresh : tracks.slice();
  const allowed = blockedArtists.size
    ? base.filter((track) => !blockedArtists.has(track.artistId))
    : base;
  const pool = allowed.length ? allowed : base;

  const byArtist = new Map();
  for (const track of pool) {
    const key = track.artistId || track.id;
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key).push(track);
  }

  const buckets = shuffle([...byArtist.values()].map((list) => shuffle(list)));
  const result = [];
  const recentArtists = [];

  while (result.length < pool.length) {
    const available = buckets.filter((list) => list.length);
    if (!available.length) break;

    const spread = available.filter((list) => !recentArtists.includes(list[0].artistId));
    const source = spread.length ? spread : available;
    const bucket = source[Math.floor(Math.random() * source.length)];
    const track = bucket.shift();

    result.push(track);
    recentArtists.push(track.artistId);
    if (recentArtists.length > 2) recentArtists.shift();
  }

  return result;
}

export class Player {
  constructor(root) {
    this.root = root;
    this.audio = new Audio();
    this.audio.preload = "metadata";

    this.queue = [];
    this.index = -1;
    this.mode = null; // "wave" | "artist"
    this.pool = null; // все треки для бесконечной волны

    // Артисты, которых пользователь попросил реже показывать в «Волне».
    this.disliked = new Set();

    this.onStateChange = null;
    this.onError = null;
    this.onQueueChange = null;
    this.onToggleFavorite = null;
    this.onToggleQueue = null;

    this.startAt = 0;
    this.lastPersist = 0;
    this.lastPositionSync = 0;
    this.preloadedTrackId = null;
    this.preloader = null;
    this.retried = new Set();
    this.scrubbing = false;

    this.ui = {
      art: root.querySelector("#player-art"),
      artLetter: root.querySelector("#player-art-letter"),
      artImg: root.querySelector("#player-art-img"),
      title: root.querySelector("#player-title"),
      artist: root.querySelector("#player-artist"),
      seek: root.querySelector("#seek"),
      toggle: root.querySelector("#toggle"),
      prev: root.querySelector("#prev"),
      next: root.querySelector("#next"),
      close: root.querySelector("#player-close"),
      backdrop: root.querySelector(".player__backdrop"),
      timeCurrent: root.querySelector("#time-current"),
      timeTotal: root.querySelector("#time-total"),
      volume: root.querySelector("#volume"),
      mute: root.querySelector("#mute"),
      fav: root.querySelector("#player-fav"),
      queue: root.querySelector("#queue-btn"),
    };

    this.#bindUi();
    this.#bindAudio();
    this.#bindMediaSession();
    this.#restoreVolume();

    document.addEventListener("pagehide", () => this.#saveState());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.#saveState();
    });
  }

  get current() {
    return this.queue[this.index] || null;
  }

  get isPlaying() {
    return !this.audio.paused && !this.audio.ended;
  }

  get isEnded() {
    return this.audio.ended;
  }

  /* ---------- Публичное управление ---------- */

  /** Бесконечная «Моя волна»: перемешивает все треки сайта. */
  startWave(tracks, { recentIds = [] } = {}) {
    if (!tracks.length) return false;
    this.pool = tracks.slice();
    const lastId = this.current?.id;
    const next = smartShuffle(this.pool, {
      recentIds,
      blockedArtists: this.disliked,
    });
    // Не начинаем новый круг с того же трека, что только что играл.
    if (next.length > 1 && next[0].id === lastId) {
      [next[0], next[1]] = [next[1], next[0]];
    }
    this.queue = next;
    this.index = 0;
    this.mode = "wave";
    this.#load(true);
    return true;
  }

  /** Включает артиста: по порядку или вперемешку. */
  playArtist(artist, { shuffled = false, startId = null } = {}) {
    if (!artist || !artist.tracks.length) return false;
    this.pool = null;
    this.queue = shuffled
      ? smartShuffle(artist.tracks)
      : artist.tracks.slice();
    this.index = startId
      ? Math.max(0, this.queue.findIndex((track) => track.id === startId))
      : 0;
    this.mode = "artist";
    this.#load(true);
    return true;
  }

  /** Клик по конкретному треку в списке артиста. */
  playTrack(track, artist) {
    if (!track) return false;
    if (this.current?.id === track.id) {
      this.toggle();
      return true;
    }
    return this.playArtist(artist, { startId: track.id });
  }

  /** Восстанавливает последний трек и позицию после перезагрузки. */
  restore(library) {
    const saved = readJSON(LAST_KEY, null);
    if (!saved || !saved.trackId || !library) return false;

    const artist = library.artists.find((item) => item.id === saved.artistId);
    if (!artist) return false;
    const track = artist.tracks.find((item) => item.id === saved.trackId);
    if (!track) return false;

    const time = Math.max(0, Number(saved.time) || 0);

    if (saved.mode === "wave" && library.allTracks?.length) {
      const rest = smartShuffle(
        library.allTracks.filter((item) => item.id !== track.id),
        { recentIds: [track.id] },
      );
      this.pool = library.allTracks.slice();
      this.queue = [track, ...rest];
      this.index = 0;
      this.mode = "wave";
    } else {
      this.pool = null;
      this.queue = artist.tracks.slice();
      this.index = Math.max(0, artist.tracks.findIndex((item) => item.id === track.id));
      this.mode = "artist";
    }

    this.#load(false, time);
    return true;
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused || this.audio.ended) {
      this.#play();
    } else {
      this.audio.pause();
    }
  }

  next({ auto = false } = {}) {
    if (!this.queue.length) return;

    const isLast = this.index >= this.queue.length - 1;
    if (isLast) {
      if (this.mode === "wave" && this.pool?.length) {
        this.#nextWaveRound();
      } else if (auto) {
        this.audio.pause();
        return;
      } else {
        this.index = 0;
      }
    } else {
      this.index += 1;
    }

    this.#load(true);
  }

  prev() {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    if (this.index > 0) {
      this.index -= 1;
    } else if (this.mode === "wave") {
      this.index = this.queue.length - 1;
    } else {
      this.audio.currentTime = 0;
      return;
    }
    this.#load(true);
  }

  /** Переход к треку из очереди. */
  jumpTo(target) {
    const index = Number(target);
    if (!Number.isInteger(index) || index < 0 || index >= this.queue.length) return;
    this.index = index;
    this.#load(true);
  }

  /** Убирает трек из очереди, не ломая текущий. */
  removeAt(target) {
    const index = Number(target);
    if (!Number.isInteger(index) || index < 0 || index >= this.queue.length) return;

    const wasCurrent = index === this.index;
    const wasPlaying = this.isPlaying;
    this.queue.splice(index, 1);

    if (!this.queue.length) {
      this.audio.pause();
      this.index = -1;
      this.#emitQueue();
      return;
    }

    if (index < this.index) {
      this.index -= 1;
    } else if (wasCurrent) {
      this.index = Math.min(this.index, this.queue.length - 1);
      this.#load(wasPlaying);
    }

    this.#emitQueue();
  }

  /** «Не это»: артист реже появляется в волне, играет следующий трек. */
  dislike() {
    const track = this.current;
    if (!track) return false;
    this.disliked.add(track.artistId);
    this.next();
    return true;
  }

  seekBy(seconds) {
    const duration = this.audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    this.audio.currentTime = Math.min(
      duration,
      Math.max(0, this.audio.currentTime + seconds),
    );
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    this.#syncMute();
    this.#saveVolume(this.audio.volume);
  }

  setFavorite(active) {
    this.ui.fav?.setAttribute("aria-pressed", String(Boolean(active)));
  }

  persist() {
    this.#saveState();
  }

  /* ---------- Внутреннее ---------- */

  #nextWaveRound() {
    const lastId = this.current?.id;
    const recentIds = [
      ...this.queue.slice(-5).map((track) => track.id),
      ...(lastId ? [lastId] : []),
    ];
    const next = smartShuffle(this.pool, {
      recentIds,
      blockedArtists: this.disliked,
    });
    if (next.length > 1 && next[0].id === lastId) {
      [next[0], next[1]] = [next[1], next[0]];
    }
    this.queue = next;
    this.index = 0;
  }

  #load(autoplay, startAt = 0) {
    const track = this.current;
    if (!track) return;

    this.#clearPreload();
    this.startAt = Math.max(0, Number(startAt) || 0);

    this.audio.src = track.src;
    this.audio.load();
    this.#renderTrack(track);
    const total = Number(track.duration) || 0;
    this.#setFill(total > 0 ? (this.startAt / total) * 100 : 0);
    this.#setTime(this.startAt, total);
    this.#emitQueue();

    if (autoplay) this.#play();
    this.#emit();
  }

  #play() {
    const result = this.audio.play();
    if (result && typeof result.catch === "function") {
      result.catch((error) => {
        if (error && error.name === "AbortError") return;
        this.onError?.("Не удалось включить трек — нажмите «Играть» ещё раз");
      });
    }
  }

  #renderTrack(track) {
    const { art, artLetter, artImg, title, artist, seek, toggle, timeCurrent, timeTotal } = this.ui;
    this.root.hidden = false;

    art.style.cssText = gradientVars(track.id || track.artistId);
    artLetter.textContent = initialsOf(track.title);
    artImg.hidden = true;
    artImg.removeAttribute("src");

    if (track.cover) {
      artImg.onload = () => {
        artImg.hidden = false;
      };
      artImg.onerror = () => {
        artImg.hidden = true;
      };
      artImg.src = track.cover;
      this.ui.backdrop.style.setProperty(
        "--art",
        `url("${String(track.cover).replaceAll('"', "%22")}")`,
      );
    } else {
      this.ui.backdrop.style.setProperty("--art", "none");
      this.ui.backdrop.style.backgroundImage = "none";
    }

    art.title = track.artistName;
    title.textContent = track.title;
    artist.textContent = track.artistName;
    seek.value = "0";
    seek.setAttribute("aria-valuetext", `${track.title}, ${track.artistName}`);
    timeCurrent.textContent = formatTime(this.startAt || 0);
    timeTotal.textContent = formatTime(track.duration);

    toggle.setAttribute("aria-label", "Играть");

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artistName,
        album: "Матушка",
        artwork: track.cover
          ? [{ src: new URL(track.cover, location.href).href }]
          : [],
      });
    }
  }

  #bindUi() {
    const { toggle, prev, next, seek, volume, mute, art, close, backdrop, fav, queue } = this.ui;

    toggle.addEventListener("click", () => this.toggle());
    prev.addEventListener("click", () => this.prev());
    next.addEventListener("click", () => this.next());

    fav?.addEventListener("click", () => this.onToggleFavorite?.(this.current));
    queue?.addEventListener("click", () => this.onToggleQueue?.());

    seek.addEventListener("input", () => {
      const duration = this.audio.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      const target = (Number(seek.value) / 1000) * duration;
      this.audio.currentTime = target;
      this.#setFill((target / duration) * 100);
      this.#setTime(target, duration);
      this.#syncPositionState(true);
    });

    // Пока палец/мышь держат ползунок, timeupdate не должен дёргать thumb.
    seek.addEventListener("pointerdown", () => {
      this.scrubbing = true;
    });
    const endScrub = () => {
      this.scrubbing = false;
    };
    seek.addEventListener("change", endScrub);
    window.addEventListener("pointerup", endScrub);
    window.addEventListener("pointercancel", endScrub);

    volume.addEventListener("input", () => {
      const value = Math.min(1, Math.max(0, Number(volume.value) || 0));
      this.audio.muted = value === 0;
      this.audio.volume = value;
      this.#setVolumeFill(value);
      this.#syncMute();
      this.#saveVolume(value);
    });

    mute.addEventListener("click", () => this.toggleMute());

    art.addEventListener("click", () => this.#toggleOpen());
    close.addEventListener("click", () => this.#close());
    backdrop.addEventListener("click", () => this.#close());

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.root.classList.contains("is-open")) {
        this.#close();
      }
    });
  }

  #bindAudio() {
    this.audio.addEventListener("timeupdate", () => {
      const duration = this.audio.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      this.#setFill((this.audio.currentTime / duration) * 100);
      this.#setTime(this.audio.currentTime, duration);
      this.#syncPositionState();
      this.#maybePersist();
      if (this.audio.currentTime > 2) this.#preloadNext();
    });

    this.audio.addEventListener("loadedmetadata", () => {
      const duration = this.audio.duration;

      if (this.startAt > 0 && Number.isFinite(duration) && duration > 0) {
        this.audio.currentTime = Math.min(this.startAt, Math.max(0, duration - 0.5));
        this.startAt = 0;
      }

      if (Number.isFinite(duration) && duration > 0) {
        this.#setFill((this.audio.currentTime / duration) * 100);
        this.#setTime(this.audio.currentTime, duration);
      } else {
        this.#setFill(0);
      }
      this.#syncPositionState(true);
      this.#emit();
    });

    this.audio.addEventListener("play", () => {
      this.#emit();
      this.#syncPositionState(true);
    });
    this.audio.addEventListener("pause", () => {
      this.#emit();
      this.#syncPositionState(true);
      this.#saveState();
    });
    this.audio.addEventListener("volumechange", () => this.#syncMute());
    this.audio.addEventListener("seeked", () => {
      const duration = this.audio.duration;
      if (Number.isFinite(duration) && duration > 0) {
        this.#setFill((this.audio.currentTime / duration) * 100);
        this.#setTime(this.audio.currentTime, duration);
      }
      this.#syncPositionState(true);
    });

    this.audio.addEventListener("ended", () => this.next({ auto: true }));

    this.audio.addEventListener("error", () => {
      const track = this.current;
      if (!track) return;

      const canRetry = this.queue.length > 1 && !this.retried.has(track.id);
      if (canRetry) {
        this.retried.add(track.id);
        this.onError?.(`«${track.title}» не загрузился — пробуем ещё раз`);
        window.setTimeout(() => {
          if (this.current?.id !== track.id) return;
          this.audio.src = track.src;
          this.audio.load();
          this.#play();
        }, 1200);
        return;
      }

      if (this.queue.length > 1) {
        this.onError?.(`Не удалось загрузить «${track.title}» — включаю следующий`);
        window.setTimeout(() => {
          if (this.current?.id === track.id) this.next({ auto: true });
        }, 800);
        return;
      }

      this.onError?.(`Не удалось загрузить трек «${track.title}»`);
    });
  }

  #bindMediaSession() {
    if (!("mediaSession" in navigator)) return;

    const handlers = {
      play: () => this.#play(),
      pause: () => this.audio.pause(),
      previoustrack: () => this.prev(),
      nexttrack: () => this.next(),
      seekbackward: () => this.seekBy(-10),
      seekforward: () => this.seekBy(10),
      seekto: (details) => {
        if (Number.isFinite(details.seekTime)) {
          this.audio.currentTime = details.seekTime;
        }
      },
    };

    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* некоторые действия не поддерживаются браузером */
      }
    }
  }

  /** Прогресс на экране блокировки: без него нет перемотки в системном плеере. */
  #syncPositionState(force = false) {
    if (!("mediaSession" in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== "function") return;

    const now = Date.now();
    if (!force && now - this.lastPositionSync < 900) return;

    const duration = this.audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    this.lastPositionSync = now;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.audio.playbackRate || 1,
        position: Math.min(Math.max(this.audio.currentTime || 0, 0), duration),
      });
    } catch {
      /* Safari иногда ругается на позицию 0 */
    }
  }

  /* ---------- Предзагрузка следующего трека ---------- */

  #preloadNext() {
    const nextTrack = this.queue[this.index + 1];
    if (!nextTrack || nextTrack.id === this.preloadedTrackId) return;

    const connection = navigator.connection;
    if (connection?.saveData) return;
    if (connection?.effectiveType && /(^|-)2g$/.test(connection.effectiveType)) return;

    this.#clearPreload();

    try {
      const element = new Audio();
      element.preload = "auto";
      element.muted = true;
      element.src = nextTrack.src;
      element.load();
      this.preloader = element;
      this.preloadedTrackId = nextTrack.id;
    } catch {
      /* предзагрузка — необязательная роскошь */
    }
  }

  #clearPreload() {
    if (this.preloader) {
      try {
        this.preloader.src = "";
      } catch {
        /* ignore */
      }
      this.preloader = null;
    }
    this.preloadedTrackId = null;
  }

  /* ---------- Полноэкранный плеер ---------- */

  #toggleOpen() {
    if (!this.current) return;

    if (this.root.classList.contains("is-open")) {
      this.#close();
    } else {
      this.root.classList.add("is-open");
      document.body.classList.add("player-open");
      this.ui.art.setAttribute("aria-expanded", "true");
      this.ui.close.focus({ preventScroll: true });
    }
  }

  #close() {
    if (!this.root.classList.contains("is-open")) return;
    this.root.classList.remove("is-open");
    document.body.classList.remove("player-open");
    this.ui.art.setAttribute("aria-expanded", "false");
    this.ui.art.focus({ preventScroll: true });
  }

  /* ---------- Громкость и время ---------- */

  #restoreVolume() {
    let value = 1;
    const saved = readJSON(VOLUME_KEY, null);
    if (typeof saved === "number") value = saved;
    if (!Number.isFinite(value)) value = 1;
    value = Math.min(1, Math.max(0, value));

    this.audio.volume = value;
    this.audio.muted = value === 0;
    this.ui.volume.value = String(value);
    this.#setVolumeFill(value);
    this.#syncMute();
  }

  #saveVolume(value) {
    writeJSON(VOLUME_KEY, value);
  }

  #setVolumeFill(value) {
    this.ui.volume.style.setProperty("--v", `${Math.round(value * 100)}%`);
  }

  #syncMute() {
    const muted = this.audio.muted || this.audio.volume === 0;
    this.ui.mute.classList.toggle("is-muted", muted);
    this.ui.mute.setAttribute("aria-pressed", String(muted));
    this.ui.mute.setAttribute("aria-label", muted ? "Включить звук" : "Выключить звук");
    this.#setVolumeFill(this.audio.muted ? 0 : this.audio.volume);
  }

  #setFill(percent) {
    const value = Math.max(0, Math.min(100, percent));
    this.ui.seek.style.setProperty("--p", `${value}%`);
    if (!this.scrubbing) {
      this.ui.seek.value = String(Math.round(value * 10));
    }
    this.ui.seek.setAttribute("aria-valuenow", String(Math.round(value)));
  }

  #setTime(current, total) {
    this.ui.timeCurrent.textContent = formatTime(current);
    this.ui.timeTotal.textContent = formatTime(total);
  }

  /* ---------- Сохранение позиции ---------- */

  #maybePersist() {
    if (Math.abs((this.audio.currentTime || 0) - this.lastPersist) < 5) return;
    this.lastPersist = this.audio.currentTime || 0;
    this.#saveState();
  }

  #saveState() {
    const track = this.current;
    if (!track) return;
    writeJSON(LAST_KEY, {
      trackId: track.id,
      artistId: track.artistId,
      mode: this.mode,
      time: Math.max(0, Math.round(this.audio.currentTime || 0)),
      savedAt: Date.now(),
    });
  }

  #emitQueue() {
    this.onQueueChange?.();
  }

  #emit() {
    this.ui.toggle.setAttribute("aria-label", this.isPlaying ? "Пауза" : "Играть");
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = this.isPlaying ? "playing" : "paused";
    }
    this.onStateChange?.(this.current);
  }
}

export { formatTime, MOBILE_QUERY };
