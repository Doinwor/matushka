/**
 * Плеер «Матушка».
 * Живёт вне экранов: переходы по сайту не прерывают музыку.
 */

import { formatTime, gradientVars, initialOf, shuffle } from "./data.js";

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
      title: root.querySelector("#player-title"),
      artist: root.querySelector("#player-artist"),
      seek: root.querySelector("#seek"),
      toggle: root.querySelector("#toggle"),
      prev: root.querySelector("#prev"),
      next: root.querySelector("#next"),
    };

    this.#bindUi();
    this.#bindAudio();
    this.#bindMediaSession();
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
    const { art, title, artist, seek, toggle } = this.ui;
    this.root.hidden = false;

    if (track.cover) {
      art.style.backgroundImage = `url("${track.cover}")`;
      art.textContent = "";
    } else {
      art.style.cssText = gradientVars(track.artistId);
      art.style.backgroundImage = "";
      art.textContent = initialOf(track.artistName);
    }

    art.title = track.artistName;
    title.textContent = track.title;
    artist.textContent = track.artistName;
    seek.value = "0";
    seek.setAttribute("aria-valuetext", `${track.title}, ${track.artistName}`);

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
    const { toggle, prev, next, seek } = this.ui;

    toggle.addEventListener("click", () => this.toggle());
    prev.addEventListener("click", () => this.prev());
    next.addEventListener("click", () => this.next());

    seek.addEventListener("input", () => {
      const duration = this.audio.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      this.audio.currentTime = (Number(seek.value) / 1000) * duration;
      this.#setFill((Number(seek.value) / 1000) * 100);
    });
  }

  #bindAudio() {
    this.audio.addEventListener("timeupdate", () => {
      const duration = this.audio.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      this.#setFill((this.audio.currentTime / duration) * 100);
    });

    this.audio.addEventListener("loadedmetadata", () => {
      this.#setFill(0);
      this.#emit();
    });

    this.audio.addEventListener("play", () => this.#emit());
    this.audio.addEventListener("pause", () => this.#emit());

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

  #setFill(percent) {
    const value = Math.max(0, Math.min(100, percent));
    this.ui.seek.style.setProperty("--p", `${value}%`);
  }

  #emit() {
    this.onStateChange?.(this.current);
  }
}

export { formatTime };
