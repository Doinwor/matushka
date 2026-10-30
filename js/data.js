/**
 * Данные сайта.
 * Единственный источник правды — data/library.json.
 * ПК-программа будет менять этот файл через GitHub API.
 */

const DATA_URL = "data/library.json";

/** Палитры для обложек-заглушек (пока у треков нет картинок). */
const PALETTES = [
  ["#7c2622", "#e2493f"],
  ["#1d3a70", "#4f7ee8"],
  ["#29503a", "#68a06b"],
  ["#5a3a14", "#d79a4a"],
  ["#3b2a57", "#8f6bd8"],
  ["#123f47", "#3fa6b5"],
  ["#5b2340", "#d2649a"],
  ["#3f3a1c", "#b7a447"],
];

export async function loadLibrary() {
  const res = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Не удалось загрузить данные сайта (${res.status})`);
  }
  return normalize(await res.json());
}

function normalize(raw) {
  const rawSite = raw && typeof raw.site === "object" && raw.site ? raw.site : {};

  const site = {
    title: rawSite.title ? String(rawSite.title) : "",
    tagline: rawSite.tagline ? String(rawSite.tagline) : "",
    noticeEnabled: rawSite.noticeEnabled !== false,
    noticeTitle: rawSite.noticeTitle ? String(rawSite.noticeTitle) : "",
    noticeText: rawSite.noticeText ? String(rawSite.noticeText) : "",
  };

  // Скрытые в админке артисты и треки остаются в data/library.json,
  // но на сайт не попадают.
  const artists = (Array.isArray(raw?.artists) ? raw.artists : [])
    .filter((a) => a && a.id && a.name && !a.hidden)
    .map((a) => {
      const tracks = (Array.isArray(a.tracks) ? a.tracks : [])
        .filter((t) => t && t.id && t.title && t.src && !t.hidden)
        .map((t) => ({
          ...t,
          id: String(t.id),
          title: String(t.title),
          src: String(t.src),
          artistId: String(a.id),
          artistName: String(a.name),
          duration: Number(t.duration) || 0,
          year: t.year ?? null,
          cover: t.cover ? String(t.cover) : null,
          hidden: Boolean(t.hidden),
        }));

      return {
        ...a,
        id: String(a.id),
        name: String(a.name),
        genre: a.genre || "",
        bio: a.bio || "",
        photo: a.photo ? String(a.photo) : null,
        hidden: Boolean(a.hidden),
        tracks,
      };
    });

  return {
    site,
    artists,
    allTracks: artists.flatMap((a) => a.tracks),
    version: raw?.version ?? 1,
  };
}

/** Стабильный цвет обложки для артиста или трека. */
export function paletteFor(seed) {
  let hash = 0;
  const str = String(seed || "");
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return PALETTES[hash % PALETTES.length];
}

/**
 * Буквы-заглушка: до двух первых букв слов.
 * «Берёзовый свет» → «БС», «Анна» → «А».
 */
export function initialsOf(name) {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let result = "";
  for (const word of words) {
    if (result.length >= 2) break;
    const letter = word.charAt(0).toUpperCase();
    if (!result.includes(letter)) result += letter;
  }

  return result || "М";
}

/** CSS-переменные для градиентной заглушки. */
export function gradientVars(seed) {
  const [c1, c2] = paletteFor(seed);
  return `--c1:${c1};--c2:${c2}`;
}

export function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function pluralTracks(n) {
  const count = Math.abs(Number(n) || 0) % 100;
  const last = count % 10;
  if (count > 10 && count < 20) return "треков";
  if (last === 1) return "трек";
  if (last >= 2 && last <= 4) return "трека";
  return "треков";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
