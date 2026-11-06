/**
 * Настройки «Матушки».
 * Хранятся только в localStorage — data/library.json и структура данных не меняются.
 */

const SETTINGS_KEY = "matushka:settings";

export const DEFAULT_SETTINGS = {
  theme: "dark", // dark | light | system
  accent: "red", // red | blue | gold
  motion: "auto", // auto | reduce
  ambient: true,
  density: "comfortable", // comfortable | compact
  speed: 1,
  preload: true,
  haptics: true,
  toasts: true,
};

export function readSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return normalize(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* приватный режим */
  }
}

export function patchSettings(settings, patch) {
  const next = normalize({ ...settings, ...patch });
  saveSettings(next);
  return next;
}

export function normalize(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const theme = ["dark", "light", "system"].includes(source.theme)
    ? source.theme
    : DEFAULT_SETTINGS.theme;
  const accent = ["red", "blue", "gold"].includes(source.accent)
    ? source.accent
    : DEFAULT_SETTINGS.accent;
  const motion = ["auto", "reduce"].includes(source.motion)
    ? source.motion
    : DEFAULT_SETTINGS.motion;
  const density = ["comfortable", "compact"].includes(source.density)
    ? source.density
    : DEFAULT_SETTINGS.density;
  const speed = clamp(Number(source.speed) || 1, 0.75, 1.5);

  return {
    theme,
    accent,
    motion,
    ambient: source.ambient !== false,
    density,
    speed: [0.75, 1, 1.25, 1.5].includes(speed) ? speed : 1,
    preload: source.preload !== false,
    haptics: source.haptics !== false,
    toasts: source.toasts !== false,
  };
}

export function resolvedTheme(theme) {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return theme === "light" ? "light" : "dark";
}

export function applySettings(settings) {
  const root = document.documentElement;
  const theme = resolvedTheme(settings.theme);

  root.dataset.theme = theme;
  root.dataset.accent = settings.accent;
  root.dataset.motion = settings.motion;
  root.dataset.density = settings.density;
  root.dataset.ambient = settings.ambient ? "on" : "off";
  root.style.colorScheme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f2ece1" : "#07080a");
}

export function watchSystemTheme(callback) {
  const query = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => callback();
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", handler);
  } else if (typeof query.addListener === "function") {
    query.addListener(handler);
  }
  return () => {
    if (typeof query.removeEventListener === "function") {
      query.removeEventListener("change", handler);
    } else if (typeof query.removeListener === "function") {
      query.removeListener(handler);
    }
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
