/**
 * Эквалайзер «Матушки» на Web Audio API.
 * Подключается к существующему <audio> плеера один раз.
 * Состояние хранится в localStorage.
 */

const EQ_KEY = "matushka:equalizer";

export const EQ_BANDS = [
  { hz: 60, label: "60" },
  { hz: 170, label: "170" },
  { hz: 310, label: "310" },
  { hz: 600, label: "600" },
  { hz: 1000, label: "1k" },
  { hz: 3000, label: "3k" },
  { hz: 6000, label: "6k" },
  { hz: 12000, label: "12k" },
];

export const EQ_PRESETS = {
  flat: { label: "Ровно", gains: [0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: "Низкие", gains: [7, 5, 3, 1, 0, -1, -1, -2] },
  vocal: { label: "Вокал", gains: [-2, -1, 1, 3, 5, 4, 2, -1] },
  rock: { label: "Рок", gains: [4, 3, 1, -1, -1, 1, 3, 4] },
  classical: { label: "Классика", gains: [3, 2, 0, -1, -1, 0, 2, 3] },
  electronic: { label: "Электро", gains: [6, 4, 1, 0, -1, 2, 4, 5] },
};

const DEFAULT_STATE = {
  enabled: false,
  preamp: 0,
  preset: "flat",
  bands: [0, 0, 0, 0, 0, 0, 0, 0],
};

function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(EQ_KEY) || "{}");
    const bands = Array.isArray(raw.bands)
      ? raw.bands.slice(0, EQ_BANDS.length).map((value) => clamp(Number(value) || 0, -12, 12))
      : DEFAULT_STATE.bands.slice();

    while (bands.length < EQ_BANDS.length) bands.push(0);

    return {
      enabled: Boolean(raw.enabled),
      preamp: clamp(Number(raw.preamp) || 0, -12, 12),
      preset: EQ_PRESETS[raw.preset] ? raw.preset : "custom",
      bands,
    };
  } catch {
    return { ...DEFAULT_STATE, bands: DEFAULT_STATE.bands.slice() };
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

export class Equalizer {
  constructor(audio, { onChange } = {}) {
    this.audio = audio;
    this.onChange = onChange;
    this.state = readState();

    this.ctx = null;
    this.source = null;
    this.filters = [];
    this.preampNode = null;
    this.failed = false;

    this.#bind();
  }

  get ready() {
    return Boolean(this.ctx);
  }

  /** Создаёт аудиограф. Можно вызывать сколько угодно — граф создаётся один раз. */
  ensure() {
    if (this.ctx || this.failed) return this.ctx;

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      this.failed = true;
      return null;
    }

    try {
      this.ctx = new AudioCtor();
      this.source = this.ctx.createMediaElementSource(this.audio);
      this.preampNode = this.ctx.createGain();

      let node = this.source;
      for (const band of EQ_BANDS) {
        const filter = this.ctx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = band.hz;
        filter.Q.value = 1.1;
        node.connect(filter);
        node = filter;
        this.filters.push(filter);
      }

      node.connect(this.preampNode);
      this.preampNode.connect(this.ctx.destination);
      this.#apply();
    } catch (error) {
      console.warn("Эквалайзер недоступен:", error);
      this.failed = true;
      this.ctx = null;
      this.filters = [];
    }

    return this.ctx;
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  toggle() {
    return this.setEnabled(!this.state.enabled);
  }

  setEnabled(value) {
    this.state.enabled = Boolean(value);
    if (this.state.enabled) {
      this.ensure();
      this.resume();
    }
    this.#apply();
    this.#save();
    this.onChange?.(this.state);
    return this.state.enabled;
  }

  setBand(index, value) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= EQ_BANDS.length) return;
    this.state.bands[i] = clamp(Number(value) || 0, -12, 12);
    this.state.preset = "custom";
    this.ensure();
    this.#apply();
    this.#save();
    this.onChange?.(this.state);
  }

  setPreamp(value) {
    this.state.preamp = clamp(Number(value) || 0, -12, 12);
    this.ensure();
    this.#apply();
    this.#save();
    this.onChange?.(this.state);
  }

  applyPreset(name) {
    const preset = EQ_PRESETS[name];
    if (!preset) return;
    this.state.preset = name;
    this.state.bands = preset.gains.slice();
    this.state.enabled = true;
    this.ensure();
    this.resume();
    this.#apply();
    this.#save();
    this.onChange?.(this.state);
  }

  reset() {
    this.state = {
      enabled: false,
      preamp: 0,
      preset: "flat",
      bands: DEFAULT_STATE.bands.slice(),
    };
    this.#apply();
    this.#save();
    this.onChange?.(this.state);
  }

  #apply() {
    if (!this.filters.length) return;

    const enabled = this.state.enabled;
    this.filters.forEach((filter, index) => {
      filter.gain.value = enabled ? this.state.bands[index] : 0;
    });

    if (this.preampNode) {
      this.preampNode.gain.value = enabled ? dbToGain(this.state.preamp) : 1;
    }
  }

  #save() {
    try {
      localStorage.setItem(EQ_KEY, JSON.stringify(this.state));
    } catch {
      /* приватный режим */
    }
  }

  #bind() {
    // Контекст можно возобновить только жестом — ловим первое касание/клик.
    const resume = () => this.resume();
    this.audio.addEventListener("play", resume);
    this.audio.addEventListener("playing", resume);
    document.addEventListener("pointerdown", resume, { passive: true });
  }
}
