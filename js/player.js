/**
 * Плеер «Матушка».
 * Живёт вне экранов: переходы по сайту не прерывают музыку.
 * На телефоне открывается на весь экран, на ПК — плавающей панелью.
 */

import { formatTime, gradientVars, initialsOf, shuffle } from "./data.js?v=20261030";

const VOLUME_KEY = "matushka:volume";
const MOBILE_QUERY = "(max-width: 899px)";

export class Player {
  constructor(root) {
    this.root = root;
    this.audio = new Audio();
    this.audio.preload = "metadata";

    this.queue = [];
    this.index = -1;
    this.mode = null; // "wave" | "artist"
    this.pool = null; // все треки для бесконечной волны
    this.onStateChange = null;
    this.onError = null;

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
    };

    this.#bindUi();
    this.#bindAudio();
    this.#bindMediaSession();
    this.#restoreVolume();
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
  startWave(tracks) {
    if (!tracks.length) return false;
    this.pool = tracks.slice();
    const lastId = this.current?.id;
    const next = shuffle(this.pool);
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
    this.queue = shuffled ? shuffle(artist.tracks) : artist.tracks.slice();
    this.index = startId
      ? Math.max(0, this.queue.findIndex((t) => t.id === startId))
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

  /* ---------- Внутреннее ---------- */

  #nextWaveRound() {
    const lastId = this.current?.id;
    const next = shuffle(this.pool);
    if (next.length > 1 && next[0].id === lastId) {
      [next[0], next[1]] = [next[1], next[0]];
    }
    this.queue = next;
    this.index = 0;
  }

  #load(autoplay) {
    const track = this.current;
    if (!track) return;

    this.audio.src = track.src;
    this.audio.load();
    this.#renderTrack(track);
    this.#setFill(0);
    this.#setTime(0, track.duration || 0);

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
      this.ui.backdrop.style.backgroundImage = `url("${String(track.cover).replaceAll('"', "%22")}")`;
    } else {
      this.ui.backdrop.style.backgroundImage = "none";
    }

    art.title = track.artistName;
    title.textContent = track.title;
    artist.textContent = track.artistName;
    seek.value = "0";
    seek.setAttribute("aria-valuetext", `${track.title}, ${track.artistName}`);
    timeCurrent.textContent = "0:00";
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
    const { toggle, prev, next, seek, volume, mute, art, close, backdrop } = this.ui;

    toggle.addEventListener("click", () => this.toggle());
    prev.addEventListener("click", () => this.prev());
    next.addEventListener("click", () => this.next());

    seek.addEventListener("input", () => {
      const duration = this.audio.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      this.audio.currentTime = (Number(seek.value) / 1000) * duration;
      this.#setFill((Number(seek.value) / 1000) * 100);
      this.#setTime(this.audio.currentTime, duration);
    });

    volume.addEventListener("input", () => {
      const value = Math.min(1, Math.max(0, Number(volume.value) || 0));
      this.audio.muted = value === 0;
      this.audio.volume = value;
      this.#setVolumeFill(value);
      this.#syncMute();
      this.#saveVolume(value);
    });

    mute.addEventListener("click", () => {
      this.audio.muted = !this.audio.muted;
      this.#syncMute();
    });

    art.addEventListener("click", () => this.#toggleOpen());
    close.addEventListener("click", () => this.#close());
    backdrop.addEventListener("click", () => this.#close());

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.root.classList.contains("is-open")) {
        this.#close();
      }
    });

    const mobile = window.matchMedia(MOBILE_QUERY);
    const onChange = () => {
      if (!mobile.matches) this.#close();
    };
    if (typeof mobile.addEventListener === "function") {
      mobile.addEventListener("change", onChange);
    } else if (typeof mobile.addListener === "function") {
      mobile.addListener(onChange);
    }
  }

  #bindAudio() {
    this.audio.addEventListener("timeupdate", () => {
      const duration = this.audio.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      this.#setFill((this.audio.currentTime / duration) * 100);
      this.#setTime(this.audio.currentTime, duration);
    });

    this.audio.addEventListener("loadedmetadata", () => {
      this.#setFill(0);
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.#setTime(this.audio.currentTime, this.audio.duration);
      }
      this.#emit();
    });

    this.audio.addEventListener("play", () => this.#emit());
    this.audio.addEventListener("pause", () => this.#emit());
    this.audio.addEventListener("volumechange", () => this.#syncMute());

    this.audio.addEventListener("ended", () => this.next({ auto: true }));

    this.audio.addEventListener("error", () => {
      if (!this.current) return;
      this.onError?.(`Не удалось загрузить трек «${this.current.title}»`);
    });
  }

  #bindMediaSession() {
    if (!("mediaSession" in navigator)) return;

    const handlers = {
      play: () => this.#play(),
      pause: () => this.audio.pause(),
      previoustrack: () => this.prev(),
      nexttrack: () => this.next(),
      seekbackward: () => {
        this.audio.currentTime = Math.max(0, this.audio.currentTime - 10);
      },
      seekforward: () => {
        this.audio.currentTime = Math.min(
          this.audio.duration || 0,
          this.audio.currentTime + 10,
        );
      },
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

  /* ---------- Полноэкранный плеер ---------- */

  #toggleOpen() {
    if (!this.current) return;
    if (!window.matchMedia(MOBILE_QUERY).matches) return;

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
    try {
      const saved = localStorage.getItem(VOLUME_KEY);
      if (saved !== null) value = Number(saved);
    } catch {
      /* приватный режим */
    }
    if (!Number.isFinite(value)) value = 1;
    value = Math.min(1, Math.max(0, value));

    this.audio.volume = value;
    this.audio.muted = value === 0;
    this.ui.volume.value = String(value);
    this.#setVolumeFill(value);
    this.#syncMute();
  }

  #saveVolume(value) {
    try {
      localStorage.setItem(VOLUME_KEY, String(value));
    } catch {
      /* приватный режим */
    }
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
  }

  #setTime(current, total) {
    this.ui.timeCurrent.textContent = formatTime(current);
    this.ui.timeTotal.textContent = formatTime(total);
  }

  #emit() {
    this.ui.toggle.setAttribute("aria-label", this.isPlaying ? "Пауза" : "Играть");
    this.onStateChange?.(this.current);
  }
}

export { formatTime };
