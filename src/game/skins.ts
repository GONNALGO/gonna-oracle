// GONNAVERSE skin system: 10 skins, NFT -> skin map, lazy frame loading,
// fighter selection persistence (last fighter / recents / favorite).

export const SKINS = ['gonna', 'invert', 'black', 'patriot', 'fire', 'rainbow', 'leaf', 'pollution', 'acid', 'alien'] as const;
export type SkinId = (typeof SKINS)[number];

export const SKIN_INFO: Record<SkinId, { label: string; accent: string }> = {
  gonna: { label: 'GONNA', accent: '#7fd858' },
  invert: { label: 'INVERT', accent: '#b45aff' },
  black: { label: 'BLACK', accent: '#8a8f9c' },
  patriot: { label: 'PATRIOT', accent: '#5a9cff' },
  fire: { label: 'FIRE', accent: '#ff8a3c' },
  rainbow: { label: 'RAINBOW', accent: '#ff6bd8' },
  leaf: { label: 'LEAF', accent: '#a5e84a' },
  pollution: { label: 'POLLUTION', accent: '#9aa06a' },
  acid: { label: 'ACID', accent: '#d8f542' },
  alien: { label: 'ALIEN', accent: '#42f5d4' },
};

export function isSkin(s: string): s is SkinId {
  return (SKINS as readonly string[]).includes(s);
}

// ---------- NFT -> skin map (public/data/gonna-nft-skins.json) ----------
export interface NftSkinEntry {
  name: string;
  skin: string;
}
let skinMap: Record<string, NftSkinEntry> | null = null;
let skinMapPromise: Promise<Record<string, NftSkinEntry>> | null = null;

// v9.1 NAME GUARD: only real collection names can EVER be fighters.
// On-chain naming is "GONNA 123" / "GONNA123" / even " GONNA 48" (leading
// space) — anything else (e.g. the user's rogue "CompX Galaxy Card", ASA
// 3193890311) is rejected even if the map is regenerated with junk in it.
const GONNA_NAME = /^\s*GONNA\s*#?\s?\d+$/i;
export function isGonnaName(name: string): boolean {
  return GONNA_NAME.test(name);
}

function guardSkinMap(m: Record<string, NftSkinEntry>): Record<string, NftSkinEntry> {
  const out: Record<string, NftSkinEntry> = {};
  for (const k of Object.keys(m)) {
    const e = m[k];
    if (e && typeof e.name === 'string' && isGonnaName(e.name)) out[k] = e;
  }
  return out;
}

export function loadSkinMap(): Promise<Record<string, NftSkinEntry>> {
  if (skinMap) return Promise.resolve(skinMap);
  if (!skinMapPromise) {
    skinMapPromise = fetch('data/gonna-nft-skins.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('skin map http ' + r.status))))
      .then((m: Record<string, NftSkinEntry>) => {
        skinMap = guardSkinMap(m); // v9.1: junk names never enter the map
        return skinMap;
      })
      .catch((e) => {
        skinMapPromise = null; // retryable
        throw e;
      });
  }
  return skinMapPromise;
}

export function skinForAsset(assetId: number): { name: string; skin: SkinId } | null {
  if (!skinMap) return null;
  const e = skinMap[String(assetId)];
  if (!e) return null;
  if (!isGonnaName(e.name)) return null; // v9.1: belt and braces — junk never fights
  const s = e.skin.toLowerCase();
  if (!isSkin(s)) return null;
  return { name: e.name, skin: s };
}

// ---------- lazy per-skin frame loading (same frame map as the base 24) ----------
// Base 'gonna' frames are loaded at boot by sprites.loadFrames() — never here.
const FRAME_KEYS: [number, number][] = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) FRAME_KEYS.push([r, c]);

const frameCache = new Map<SkinId, Map<string, HTMLImageElement>>();
const framePromise = new Map<SkinId, Promise<Map<string, HTMLImageElement>>>();

export function loadSkinFrames(skin: SkinId): Promise<Map<string, HTMLImageElement>> {
  const hit = frameCache.get(skin);
  if (hit) return Promise.resolve(hit);
  const pending = framePromise.get(skin);
  if (pending) return pending;
  const p = Promise.all(
    FRAME_KEYS.map(
      ([r, c]) =>
        new Promise<[string, HTMLImageElement]>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve([r + '_' + c, img]);
          img.onerror = () => reject(new Error('skin frame failed: ' + skin + ' ' + r + '_' + c));
          img.src = 'frames/skins/' + skin + '_r' + r + '_c' + c + '.png';
        }),
    ),
  ).then((pairs) => {
    const m = new Map<string, HTMLImageElement>(pairs);
    frameCache.set(skin, m);
    return m;
  });
  framePromise.set(skin, p);
  return p;
}

export function skinFramesLoaded(skin: SkinId): Map<string, HTMLImageElement> | null {
  return frameCache.get(skin) ?? null;
}

// Eagerly cache just the idle portrait (r0_c0) of every skin for the select grid.
const portraitCache = new Map<SkinId, HTMLImageElement>();
// v16.0.1: a portrait that 404'd is FAILED, not "loading" — pickers must show
// the deterministic tinted fighter, never the old flat green swatch forever.
const portraitFailedSet = new Set<SkinId>();
export function loadSkinPortraits(onEach?: () => void): void {
  for (const skin of SKINS) {
    if (skin === 'gonna' || portraitCache.has(skin)) continue;
    const img = new Image();
    img.onload = () => {
      portraitCache.set(skin, img);
      if (onEach) onEach();
    };
    img.onerror = () => {
      portraitFailedSet.add(skin);
    };
    img.src = 'frames/skins/' + skin + '_r0_c0.png';
  }
}
export function skinPortrait(skin: SkinId): HTMLImageElement | null {
  return portraitCache.get(skin) ?? null;
}
export function skinPortraitFailed(skin: SkinId): boolean {
  return portraitFailedSet.has(skin);
}

// ---------- v16.0.1: whale-shelf paging + deterministic NFT tint ----------
// The arena CREATE CARD shelf lays fighters out 5 x 2 = 10 cells a page.
// Paging CLAMPS at both ends (no wrap): a prev/next tap past the edge is a
// no-op, and the buttons hide at the edges like the PIT board pager.
export const SHELF_PAGE = 10;
export function shelfPages(count: number): number {
  return Math.max(1, Math.ceil(Math.max(0, count) / SHELF_PAGE));
}
export function shelfPageClamp(page: number, count: number): number {
  const last = shelfPages(count) - 1;
  if (!Number.isFinite(page)) return 0; // shelf changed under us: reset safe
  return Math.min(Math.max(0, Math.floor(page)), last);
}

// Deterministic hue for an assetId (Knuth multiplicative hash): the SAME id
// always gets the SAME tint, different ids spread across the wheel.
export function nftHue(assetId: number): number {
  let h = (Math.imul(assetId >>> 0, 2654435761) >>> 0) ^ 0x9e3779b9;
  h = (h ^ (h >>> 15)) >>> 0;
  return h % 360;
}

function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 510;
  if (mx === mn) return [0, 0, l];
  const d = (mx - mn) / 255;
  const s = l > 0.5 ? d / (2 - (mx + mn) / 255) : d / ((mx + mn) / 255);
  let h: number;
  if (mx === r) h = ((g - b) / (mx - mn) + (g < b ? 6 : 0)) * 60;
  else if (mx === g) h = ((b - r) / (mx - mn) + 2) * 60;
  else h = ((r - g) / (mx - mn) + 4) * 60;
  return [h, s, l];
}

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [Math.round(f(h / 360 + 1 / 3) * 255), Math.round(f(h / 360) * 255), Math.round(f(h / 360 - 1 / 3) * 255)];
}

// The base GONNA fighter hue (~105deg green) is re-hued to nftHue(assetId),
// saturation/luminosity untouched, one offscreen pass cached per assetId.
const BASE_HUE = 105;
const tintCache = new Map<number, HTMLCanvasElement>();
export function tintedFighterPortrait(base: CanvasImageSource, assetId: number): HTMLCanvasElement | null {
  const hit = tintCache.get(assetId);
  if (hit) return hit;
  if (typeof document === 'undefined') return null; // node/CI: no canvas
  const w = (base as HTMLImageElement).naturalWidth || (base as HTMLCanvasElement).width || 0;
  const h = (base as HTMLImageElement).naturalHeight || (base as HTMLCanvasElement).height || 0;
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return null;
  x.imageSmoothingEnabled = false;
  x.drawImage(base, 0, 0);
  try {
    const d = x.getImageData(0, 0, w, h);
    const shift = nftHue(assetId) - BASE_HUE;
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const [hh, ss, ll] = rgb2hsl(px[i], px[i + 1], px[i + 2]);
      const [r, g, b] = hsl2rgb((hh + shift + 360) % 360, ss, ll);
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
    x.putImageData(d, 0, 0);
  } catch {
    return null; // tainted/unreadable source: caller falls back untinted
  }
  tintCache.set(assetId, c);
  return c;
}

// ---------- fighter selection ----------
export interface Fighter {
  skin: SkinId;
  assetId: number | null; // null = the free default GONNA
  name: string;
}

export const DEFAULT_FIGHTER: Fighter = { skin: 'gonna', assetId: null, name: 'GONNA' };

const KEY_FIGHTER = 'gonna.fighter';
const KEY_RECENT = 'gonna.recent'; // array of fighter keys, newest first, max 5
const KEY_FAV = 'gonna.fav'; // assetId (number) or ''

function lsGet(k: string): string | null {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string): void {
  try {
    window.localStorage.setItem(k, v);
  } catch { /* storage unavailable */ }
}

export function loadFighter(): Fighter {
  try {
    const raw = lsGet(KEY_FIGHTER);
    if (!raw) return { ...DEFAULT_FIGHTER };
    const f = JSON.parse(raw) as Fighter;
    if (!f || !isSkin(String(f.skin))) return { ...DEFAULT_FIGHTER };
    return { skin: f.skin, assetId: typeof f.assetId === 'number' ? f.assetId : null, name: String(f.name || 'GONNA') };
  } catch {
    return { ...DEFAULT_FIGHTER };
  }
}

export function saveFighter(f: Fighter): void {
  lsSet(KEY_FIGHTER, JSON.stringify(f));
  pushRecent(f);
}

export function fighterKey(f: Fighter): string {
  return f.assetId !== null ? 'nft:' + f.assetId : 'skin:' + f.skin;
}

export function loadRecents(): string[] {
  try {
    const raw = lsGet(KEY_RECENT);
    const a = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(a) ? a.filter((s) => typeof s === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

function pushRecent(f: Fighter): void {
  const k = fighterKey(f);
  const a = loadRecents().filter((x) => x !== k);
  a.unshift(k);
  lsSet(KEY_RECENT, JSON.stringify(a.slice(0, 5)));
}

export function loadFavorite(): number | null {
  const raw = lsGet(KEY_FAV);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function saveFavorite(assetId: number | null): void {
  lsSet(KEY_FAV, assetId === null ? '' : String(assetId));
}
