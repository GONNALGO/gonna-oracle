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

export function loadSkinMap(): Promise<Record<string, NftSkinEntry>> {
  if (skinMap) return Promise.resolve(skinMap);
  if (!skinMapPromise) {
    skinMapPromise = fetch('data/gonna-nft-skins.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('skin map http ' + r.status))))
      .then((m: Record<string, NftSkinEntry>) => {
        skinMap = m;
        return m;
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
export function loadSkinPortraits(onEach?: () => void): void {
  for (const skin of SKINS) {
    if (skin === 'gonna' || portraitCache.has(skin)) continue;
    const img = new Image();
    img.onload = () => {
      portraitCache.set(skin, img);
      if (onEach) onEach();
    };
    img.onerror = () => { /* tile falls back to a colored swatch */ };
    img.src = 'frames/skins/' + skin + '_r0_c0.png';
  }
}
export function skinPortrait(skin: SkinId): HTMLImageElement | null {
  return portraitCache.get(skin) ?? null;
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
