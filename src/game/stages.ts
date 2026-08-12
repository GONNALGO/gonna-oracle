// 6 stages: procedural parallax backgrounds + wave/obstacle layout.
// v8 DEGEN COLLECTION: full visual rework of every stage. Cached offscreen
// layers (far/mid/ground) + animated passes (neon flicker, rain, tickers,
// smoke, charts) driven by the game-loop frame. All mini-sprites and text
// strips are pre-rendered at stage build: the hot loop allocates nothing.
import { drawText } from './font';
import { VH, VW, rand } from './types';
import type { EnemyKind } from './enemies';
import type { ItemKind, ObstacleKind } from './items';
import type { BossKind } from './boss';
import { SKIN_INFO, skinPortrait } from './skins';
import type { SkinId } from './skins';
import { latestAlgorandRound } from './chain';

export interface WaveDef {
  triggerX: number;
  spawns: EnemyKind[];
}

export interface ObstacleDef {
  kind: ObstacleKind;
  x: number;
  y: number;
  contains: ItemKind | 'none' | 'random';
}

// v8: animated overlay pass. The engine calls it from the render loop with the
// game frame; the pass applies its own parallax factors (screen-space output).
export type StageAnim = (c: CanvasRenderingContext2D, camX: number, t: number) => void;

export interface StageDef {
  name: string;
  sub: string;
  track: 'stage1' | 'stage2' | 'stage3' | 'stage4' | 'stage5' | 'stage6';
  len: number;
  waves: WaveDef[];
  obstacles: ObstacleDef[];
  boss: boolean;
  bossKind: BossKind | null;
  bossTrack: 'boss' | 'boss2';
  arenaX: number;
  mint?: boolean; // v9.4: THE MINTING bonus stage (single-screen arena, own scene)
  far: HTMLCanvasElement;
  mid: HTMLCanvasElement;
  ground: HTMLCanvasElement;
  back?: StageAnim; // mid -> ground sandwich: billboards, tickers, sea, sky candles
  props?: StageAnim; // ground -> entities sandwich: sidewalk props at world depth
  front?: StageAnim; // over the action: weather + CPS1 foreground silhouettes
}

type Ctx = CanvasRenderingContext2D;

function mk(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = h;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  return [c, x];
}

function R(x: Ctx, px: number, py: number, w: number, h: number, c: string): void {
  x.fillStyle = c;
  x.fillRect(px | 0, py | 0, Math.ceil(w), Math.ceil(h));
}

function disc(x: Ctx, cx: number, cy: number, r: number, c: string): void {
  x.fillStyle = c;
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fill();
}

// deterministic 0..1 hash for per-frame flicker (no RNG state, no allocation)
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// pre-rendered mini sprite
function spr(w: number, h: number, draw: (x: Ctx) => void): HTMLCanvasElement {
  const [c, x] = mk(w, h);
  draw(x);
  return c;
}

// 3-tongue pixel flame, flickers via hash (barrels, braziers)
function flame(x: Ctx, cx: number, baseY: number, t: number, s: number): void {
  for (let i = 0; i < 3; i++) {
    const h = Math.round((5 + hash01(t * 1.7 + i * 13) * 7) * s);
    const w = Math.max(2, Math.round((5 - i * 1.5) * s));
    const dx = Math.round((hash01(t * 2.3 + i * 7) - 0.5) * 2 * s);
    x.fillStyle = i === 0 ? '#d84828' : i === 1 ? '#ff8a3c' : '#f5c542';
    x.fillRect(cx - (w >> 1) + dx, baseY - h - i, w, h);
  }
}

// soft smoke puff sprite (barrels, incense, rocket venting)
function puffSprite(): HTMLCanvasElement {
  return spr(10, 10, (x) => {
    R(x, 2, 3, 6, 5, '#5a6270');
    R(x, 3, 1, 4, 3, '#6a7280');
    R(x, 1, 4, 3, 3, '#4a525e');
    R(x, 5, 6, 4, 3, '#464e5a');
    R(x, 3, 2, 3, 2, '#8a929e');
  });
}

// ---------------- STAGE 1: GHETTO GONNA (night alley, rain) ----------------
// feature anchors shared by the cached layers and the animated passes
const S1 = {
  lounges: [150, 790], // mid-space x of the LIZARD LOUNGE facades
  tv: 470, // mid-space x of the static-TV window
  puddles: [180, 720, 1280, 1720], // world x of reflective puddles
  barrels: [520, 980, 1620], // world x of burning barrels (clear of obstacles)
  cats: [420, 1450], // world x of stray cat patrol anchors
  car: 790, // world x of the lowrider (1T GONNA)
  tape: 1330, // world x of the FUD ZONE police tape
};

function s1Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 0, w, 64, '#04070f');
  R(x, 0, 64, w, 48, '#060c18');
  R(x, 0, 112, w, 48, '#0a1424');
  R(x, 0, 160, w, 64, '#081018');
  // stars
  for (let i = 0; i < 110; i++) {
    R(x, rand(0, w), rand(0, 100), 1, 1, i % 5 === 0 ? '#f5c542' : i % 3 ? '#9fd8e8' : '#4a6a7a');
  }
  // big moon + halo
  disc(x, w * 0.78, 30, 19, '#0c1626');
  disc(x, w * 0.78, 30, 15, '#e8e4c8');
  disc(x, w * 0.78 - 5, 26, 4, '#c8c4a8');
  disc(x, w * 0.78 + 6, 36, 3, '#c8c4a8');
  // suspension bridge silhouette (left)
  R(x, 16, 108, 300, 4, '#05090f');
  R(x, 58, 58, 8, 54, '#05090f');
  R(x, 258, 58, 8, 54, '#05090f');
  R(x, 54, 58, 16, 4, '#05090f');
  R(x, 254, 58, 16, 4, '#05090f');
  for (let i = 0; i <= 24; i++) {
    const cx = 62 + i * 8.2;
    const cy = 92 - Math.sin((i / 24) * Math.PI) * 26;
    R(x, cx, cy, 1, 108 - cy, '#05090f');
  }
  R(x, 60, 40, 2, 18, '#05090f'); // antenna
  // skyline row
  let bx = 0;
  while (bx < w) {
    const bw = rand(24, 60);
    const bh = rand(30, 92);
    R(x, bx, 152 - bh, bw, bh + 72, '#060b12');
    for (let wy = 152 - bh + 4; wy < 146; wy += 8) {
      for (let wx = bx + 3; wx < bx + bw - 3; wx += 7) {
        const r = Math.random();
        if (r < 0.22) R(x, wx, wy, 2, 3, r < 0.12 ? '#b8921f' : r < 0.18 ? '#3fae4a' : '#5a8a9a');
      }
    }
    bx += bw + rand(4, 14);
  }
  return c;
}

// graffiti + posters sprayed along the alley walls (static, mid layer)
function s1Graffiti(x: Ctx, w: number): void {
  // WAGMI
  drawText(x, 'WAGMI', 66, 116, 2, '#3fae4a');
  for (let i = 0; i < 7; i++) R(x, 60 + rand(0, 70), 110 + rand(0, 20), 1, 1, '#1e6b2a');
  // GM
  drawText(x, 'GM', 388, 108, 2, '#f5c542');
  // lizard tag
  R(x, 648, 118, 18, 9, '#3fae4a');
  R(x, 662, 114, 8, 8, '#3fae4a');
  R(x, 667, 116, 2, 2, '#101018');
  R(x, 644, 122, 5, 4, '#1e6b2a');
  drawText(x, 'GZZ', 646, 130, 1, '#7fd858');
  // HODL OR DIE
  drawText(x, 'HODL OR', 986, 108, 1, '#e8e4d8');
  drawText(x, 'DIE', 1004, 118, 2, '#e23b3b');
  // FUD = REKT
  drawText(x, 'FUD = REKT', 1250, 120, 1, '#8ab4d8');
  // torn MISSING: FUD posters
  for (const px of [300, 860, 1380]) {
    R(x, px, 92, 42, 38, '#cfc8b8'); // poster
    R(x, px + 30, 112, 12, 18, '#141020'); // torn bottom-right corner
    R(x, px + 8, 124, 10, 6, '#141020'); // jagged rip
    R(x, px - 2, 90, 6, 4, '#8a8f9c'); // tape bits
    R(x, px + 38, 90, 6, 4, '#8a8f9c');
    drawText(x, 'MISSING', px + 3, 96, 1, '#3a3230');
    drawText(x, 'FUD', px + 8, 106, 2, '#7a2020');
    R(x, px + 6, 116, 18, 1, '#9a9488');
  }
  void w;
}

function s1Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  // brick building row
  let bx = 0;
  while (bx < w) {
    const bw = rand(100, 170);
    const bh = rand(70, 120);
    R(x, bx, 150 - bh, bw, bh, '#141020');
    R(x, bx, 150 - bh, bw, 3, '#241a30');
    for (let by = 150 - bh + 6; by < 150; by += 6) R(x, bx, by, bw, 1, '#1a1426'); // brick courses
    for (let wy = 150 - bh + 8; wy < 140; wy += 14) {
      for (let wx = bx + 6; wx < bx + bw - 10; wx += 12) {
        const r = Math.random();
        if (r < 0.3) {
          R(x, wx, wy, 6, 8, r < 0.12 ? '#b8860b' : r < 0.2 ? '#2a5a4a' : '#1c2c40');
          R(x, wx, wy, 6, 1, '#0d0a14');
        } else R(x, wx, wy, 6, 8, '#0d0a14');
      }
    }
    bx += bw + 4;
  }
  // fire escape
  for (let fy = 46; fy < 130; fy += 28) {
    R(x, 596, fy, 60, 3, '#0a0d14');
    for (let fx = 598; fx < 656; fx += 6) R(x, fx, fy - 6, 1, 6, '#0a0d14');
    R(x, 596, fy - 6, 60, 1, '#0a0d14');
  }
  for (let fy = 46; fy < 110; fy += 28) {
    for (let i = 0; i < 8; i++) R(x, 620 + i * 3, fy + 3 + i * 3, 2, 2, '#0a0d14');
  }
  // LIZARD LOUNGE facades (drawn over the row; neon + windows are animated)
  for (const lx of S1.lounges) {
    R(x, lx, 20, 176, 130, '#221228');
    R(x, lx, 20, 176, 3, '#2e1a38');
    for (let by = 26; by < 150; by += 6) R(x, lx, by, 176, 1, '#2a1834'); // brick
    // sign backplate (animated neon draws over it)
    R(x, lx + 8, 30, 160, 30, '#0c0612');
    R(x, lx + 8, 30, 160, 2, '#1c0a1e');
    // window hole (animated silhouettes draw over it)
    R(x, lx + 12, 66, 74, 40, '#0a0610');
    R(x, lx + 10, 64, 78, 3, '#2e1a38');
    // door with pink light + striped awning
    R(x, lx + 120, 100, 34, 50, '#120a18');
    R(x, lx + 127, 96, 20, 5, '#ff5ac8');
    for (let ax = 0; ax < 8; ax++) R(x, lx + 116 + ax * 5, 92, 3, 5, ax % 2 ? '#3a1a44' : '#ff5ac8');
    R(x, lx + 137, 116, 2, 8, '#b8860b'); // handle
    // pink light pooling at the base
    R(x, lx, 146, 176, 4, '#33142c');
  }
  s1Graffiti(x, w);
  return c;
}

function s1Ground(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84); // drawn at y=140
  R(x, 0, 0, len, 10, '#232833'); // sidewalk
  for (let cx = 0; cx < len; cx += 46) R(x, cx, 0, 1, 10, '#1a1f28'); // expansion joints
  R(x, 0, 9, len, 2, '#39434f'); // curb
  R(x, 0, 11, len, 73, '#101420'); // wet asphalt
  R(x, 0, 26, len, 20, '#141a26'); // wet sheen band
  for (let dx = 20; dx < len; dx += 60) R(x, dx, 46, 18, 2, '#8a6a1a'); // lane dashes (wet gold)
  for (let i = 0; i < len / 22; i++) R(x, rand(0, len), rand(12, 80), 2, 1, '#1c2330'); // specks
  for (let mx = 120; mx < len; mx += 340) {
    disc(x, mx, 62, 7, '#0d1017');
    disc(x, mx, 62, 5, '#141a26');
  }
  // reflective puddles
  for (const px of S1.puddles) {
    R(x, px, 18, 52, 10, '#0b1220');
    R(x, px + 4, 16, 44, 14, '#0d1626');
    R(x, px + 8, 18, 20, 2, '#233850'); // sky glint
    R(x, px + 30, 24, 8, 1, '#3a5a80'); // moon glint
  }
  // neon smears on the wet asphalt
  for (const px of [300, 900, 1400]) {
    R(x, px, 14, 26, 3, '#241226');
    R(x, px + 4, 18, 18, 2, '#2c1830');
  }
  // fallen trash
  for (const px of [420, 1060, 1560]) {
    R(x, px, 70, 8, 5, '#1c2330');
    R(x, px + 6, 68, 4, 3, '#39434f');
  }
  return c;
}

function s1Anim(): { back: StageAnim; props: StageAnim; front: StageAnim } {
  // --- pre-rendered sprites ---
  const sign = (on: boolean): HTMLCanvasElement =>
    spr(160, 30, (x) => {
      R(x, 0, 0, 160, 30, '#0c0612');
      R(x, 2, 2, 156, 26, on ? '#1c0a1e' : '#100812');
      const pink = on ? '#ff5ac8' : '#7a2a50';
      const pinkHi = on ? '#ff8ad8' : '#4a1a34';
      R(x, 1, 1, 158, 1, pinkHi);
      R(x, 1, 28, 158, 1, pinkHi);
      R(x, 1, 1, 1, 28, pinkHi);
      R(x, 158, 1, 1, 28, pinkHi);
      drawText(x, 'LIZARD LOUNGE', 9, 5, 2, pink);
      drawText(x, 'GIRLS', 62, 21, 1, on ? '#f5c542' : '#5a4a2a');
    });
  const signOn = sign(true);
  const signDim = sign(false);
  // classy window silhouettes (Streets of Rage style, never explicit)
  const win = (pose: number): HTMLCanvasElement =>
    spr(74, 40, (x) => {
      R(x, 0, 0, 74, 40, '#2a1220'); // lit interior
      R(x, 0, 34, 74, 6, '#3a1a2a'); // floor light
      R(x, 0, 0, 9, 40, '#4a1a3a'); // curtains
      R(x, 65, 0, 9, 40, '#4a1a3a');
      R(x, 0, 0, 74, 3, '#5a2a4a'); // valance
      if (pose < 2) {
        const fx = pose === 0 ? 24 : 34; // figure sway
        // elegant profile: hair bun, head, shoulders, evening dress
        R(x, fx + 2, 8, 6, 6, '#08040a'); // head
        R(x, fx + 1, 5, 4, 4, '#08040a'); // bun
        R(x, fx + 3, 14, 4, 3, '#08040a'); // neck
        R(x, fx - 2, 17, 14, 5, '#08040a'); // shoulders
        R(x, fx - 4, 22, 18, 18, '#08040a'); // dress
        if (pose === 1) {
          R(x, fx + 12, 12, 3, 8, '#08040a'); // raised arm (on the phone)
          R(x, fx + 13, 10, 3, 3, '#08040a');
        }
        R(x, fx + 13, 8, 1, 30, '#ff5ac8'); // neon rim light (classy)
        R(x, fx + 2, 8, 1, 6, '#ff8ad8');
      }
      R(x, 52, 24, 8, 10, '#120812'); // plant silhouette
      R(x, 54, 20, 4, 5, '#120812');
    });
  const winA = win(0);
  const winB = win(1);
  const winC = win(2);
  const tvF: HTMLCanvasElement[] = [];
  for (let f = 0; f < 4; f++) {
    tvF.push(
      spr(18, 14, (x) => {
        R(x, 0, 0, 18, 14, '#0a0d14');
        for (let i = 0; i < 60; i++) {
          const g = Math.random();
          R(x, rand(0, 17), rand(0, 13), 1, 1, g < 0.4 ? '#c8d4e8' : g < 0.7 ? '#4a5a70' : '#101820');
        }
      }),
    );
  }
  const barrel = spr(16, 22, (x) => {
    R(x, 1, 2, 14, 20, '#5a3a22');
    R(x, 1, 2, 14, 3, '#6a4a2a');
    R(x, 1, 9, 14, 2, '#3e2818');
    R(x, 1, 16, 14, 2, '#3e2818');
    R(x, 2, 0, 12, 3, '#1a0f08'); // open top
    R(x, 4, 1, 8, 1, '#ff8a3c'); // fire inside
  });
  const catF = [0, 1].map((f) =>
    spr(15, 10, (x) => {
      R(x, 2, 4, 9, 4, '#0d0d12'); // body
      R(x, 10, 2, 4, 4, '#0d0d12'); // head
      R(x, 10, 1, 1, 2, '#0d0d12'); // ears
      R(x, 13, 1, 1, 2, '#0d0d12');
      R(x, 12, 3, 1, 1, '#7fd858'); // eye glow
      if (f === 0) {
        R(x, 0, 1, 2, 5, '#0d0d12'); // tail up
        R(x, 3, 8, 2, 2, '#0d0d12');
        R(x, 8, 8, 2, 2, '#0d0d12');
      } else {
        R(x, 0, 5, 3, 2, '#0d0d12'); // tail low
        R(x, 4, 8, 2, 2, '#0d0d12');
        R(x, 9, 8, 2, 2, '#0d0d12');
      }
    }),
  );
  const car = spr(100, 36, (x) => {
    R(x, 4, 14, 92, 12, '#2a1a4a'); // body
    R(x, 0, 18, 10, 8, '#2a1a4a'); // nose
    R(x, 88, 16, 12, 10, '#2a1a4a'); // trunk
    R(x, 34, 4, 36, 12, '#221640'); // cabin
    R(x, 37, 6, 14, 9, '#0d1a2a'); // windows
    R(x, 55, 6, 13, 9, '#0d1a2a');
    R(x, 39, 7, 4, 2, '#3a5a80'); // glints
    R(x, 4, 20, 92, 2, '#c8ccd4'); // chrome trim
    R(x, 4, 17, 92, 1, '#f5c542'); // gold pinstripe
    drawText(x, '1T GONNA', 27, 23, 1, '#f5c542'); // livery / plate
    disc(x, 24, 28, 7, '#0a0a0e'); // wheels
    disc(x, 78, 28, 7, '#0a0a0e');
    disc(x, 24, 28, 4, '#d8d4c8');
    disc(x, 78, 28, 4, '#d8d4c8');
    disc(x, 24, 28, 2, '#8a8f9c');
    disc(x, 78, 28, 2, '#8a8f9c');
    R(x, 94, 22, 5, 4, '#e8e4d8'); // rear plate
    R(x, 1, 20, 3, 3, '#fff6d8'); // headlight
  });
  const tapeSign = spr(52, 12, (x) => {
    R(x, 0, 0, 52, 12, '#f5c542');
    for (let i = 0; i < 13; i++) {
      R(x, i * 4, 0, 2, 2, '#101018');
      R(x, i * 4 + 2, 10, 2, 2, '#101018');
    }
    drawText(x, 'FUD ZONE', 3, 3, 1, '#101018');
  });
  const walker = spr(32, 72, (x) => {
    // umbrella
    R(x, 12, 0, 8, 2, '#04060a');
    R(x, 7, 2, 18, 2, '#04060a');
    R(x, 3, 4, 26, 3, '#04060a');
    R(x, 0, 7, 32, 3, '#04060a');
    R(x, 2, 4, 28, 1, '#101a26'); // rain rim
    R(x, 15, 10, 2, 12, '#04060a'); // shaft
    // figure
    R(x, 11, 17, 9, 7, '#05070c'); // head
    R(x, 7, 24, 17, 6, '#05070c'); // shoulders
    R(x, 8, 30, 15, 26, '#05070c'); // coat
    R(x, 8, 56, 5, 14, '#05070c'); // legs
    R(x, 17, 56, 5, 14, '#05070c');
    R(x, 13, 30, 3, 8, '#0d1420'); // coat fold
    R(x, 21, 17, 2, 53, '#16222e'); // rim light
  });
  const fgcar = spr(130, 42, (x) => {
    R(x, 20, 0, 80, 10, '#04060a'); // roof
    R(x, 24, 2, 34, 7, '#0a1420'); // windows (night reflect)
    R(x, 62, 2, 30, 7, '#0a1420');
    R(x, 0, 8, 130, 26, '#04060a'); // body
    R(x, 0, 20, 130, 1, '#101a26'); // chrome line
    R(x, 18, 32, 20, 8, '#020308'); // wheel blobs
    R(x, 88, 32, 20, 8, '#020308');
    R(x, 126, 22, 4, 5, '#fff6c8'); // headlight
    R(x, 0, 22, 3, 5, '#e23b3b'); // taillight
  });
  const puff = puffSprite();
  // rain state (allocated once)
  const N = 70;
  const rxs = new Float32Array(N);
  const rys = new Float32Array(N);
  const rvs = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    rxs[i] = rand(0, VW + 40);
    rys[i] = rand(0, VH);
    rvs[i] = rand(3.2, 5.4);
  }

  const back: StageAnim = (c, camX, t) => {
    const mo = -camX * 0.55;
    for (let li = 0; li < S1.lounges.length; li++) {
      const lx = S1.lounges[li] + mo;
      if (lx > VW || lx + 176 < 0) continue;
      const r = hash01((t >> 2) * 7 + li * 31);
      if (r < 0.88) {
        c.globalAlpha = 0.1 + 0.06 * hash01(t * 0.7 + li);
        c.fillStyle = '#ff5ac8';
        c.fillRect(lx - 6, 26, 188, 44);
        c.globalAlpha = 1;
        c.drawImage(signOn, lx + 8, 30);
      } else if (r < 0.97) {
        c.drawImage(signDim, lx + 8, 30);
      }
      const st = ((t >> 7) + li) % 5;
      c.drawImage(st < 2 ? winA : st < 4 ? winB : winC, lx + 12, 66);
    }
    const tvx = S1.tv + mo;
    if (tvx > -20 && tvx < VW) {
      c.globalAlpha = 0.1 + 0.08 * hash01(t * 1.3);
      c.fillStyle = '#9ac8e8';
      c.fillRect(tvx - 3, 80, 24, 22);
      c.globalAlpha = 1;
      c.drawImage(tvF[(t >> 3) & 3], tvx, 84);
    }
  };

  const props: StageAnim = (c, camX, t) => {
    // puddle neon shimmer
    for (let pi = 0; pi < S1.puddles.length; pi++) {
      const px = S1.puddles[pi] - camX;
      if (px < -56 || px > VW) continue;
      for (let i = 0; i < 3; i++) {
        const wob = hash01(t * 0.5 + pi * 17 + i * 7);
        c.globalAlpha = 0.3 + 0.3 * wob;
        c.fillStyle = i === 1 ? '#a04a80' : '#3a6a90';
        c.fillRect(px + 6 + ((t * 0.3 + i * 13 + pi * 29) % 34), 158 + i * 7, 6 + wob * 10, 1);
      }
      c.globalAlpha = 1;
    }
    // burning barrels
    for (let bi = 0; bi < S1.barrels.length; bi++) {
      const bx = S1.barrels[bi] - camX;
      if (bx < -24 || bx > VW + 24) continue;
      c.globalAlpha = 0.14 + 0.08 * hash01(t + bi);
      c.fillStyle = '#ff8a3c';
      c.fillRect(bx - 8, 126, 32, 16);
      c.globalAlpha = 1;
      c.drawImage(barrel, bx, 120);
      flame(c, bx + 8, 121, t + bi * 23, 1);
      for (let si = 0; si < 2; si++) {
        const life = (t * 0.6 + bi * 31 + si * 37) % 60;
        c.globalAlpha = 0.32 * (1 - life / 60);
        c.drawImage(puff, bx + 4 + Math.sin((t + si * 9) * 0.07) * 3, 112 - life * 0.8);
      }
      c.globalAlpha = 1;
    }
    // stray cats
    for (let ci = 0; ci < S1.cats.length; ci++) {
      const phase = t * 0.006 + ci * 2.4;
      const cx = S1.cats[ci] + Math.sin(phase) * 46 - camX;
      if (cx < -20 || cx > VW + 20) continue;
      const f = catF[(t >> 4) & 1];
      if (Math.cos(phase) >= 0) {
        c.save();
        c.translate(cx + 15, 0);
        c.scale(-1, 1);
        c.drawImage(f, 0, 136);
        c.restore();
      } else c.drawImage(f, cx, 136);
    }
    // lowrider with hydraulics + underglow
    const carX = S1.car - camX;
    if (carX > -110 && carX < VW + 10) {
      c.globalAlpha = 0.2 + 0.1 * Math.sin(t * 0.09);
      c.fillStyle = '#3fae4a';
      c.fillRect(carX + 6, 150, 88, 4);
      c.globalAlpha = 1;
      c.drawImage(car, carX, 112 + Math.round(Math.sin(t * 0.12) * 1.2));
    }
    // FUD ZONE police tape
    const tx = S1.tape - camX;
    if (tx > -120 && tx < VW + 20) {
      c.fillStyle = '#2a2f3a';
      c.fillRect(tx, 100, 3, 40);
      c.fillRect(tx + 96, 100, 3, 40);
      c.fillStyle = '#b8860b';
      c.fillRect(tx - 1, 98, 5, 3);
      c.fillRect(tx + 95, 98, 5, 3);
      const sway = Math.sin(t * 0.07) * 1.5;
      for (let i = 0; i < 24; i++) {
        c.fillStyle = i & 1 ? '#f5c542' : '#101018';
        c.fillRect(tx + 3 + i * 4, 104 + Math.sin((i / 23) * Math.PI) * 5 + sway, 4, 3);
      }
      c.drawImage(tapeSign, tx + 24, 111 + Math.sin(t * 0.07 + 1) * 2);
    }
  };

  const front: StageAnim = (c, camX, t) => {
    void camX;
    // rain
    c.globalAlpha = 0.5;
    c.fillStyle = '#8ab4d8';
    for (let i = 0; i < N; i++) {
      rys[i] += rvs[i];
      rxs[i] -= 0.6;
      if (rys[i] > VH) {
        rys[i] = -8;
        rxs[i] = (rxs[i] + 197) % (VW + 40);
      }
      if (rxs[i] < -4) rxs[i] += VW + 40;
      c.fillRect(rxs[i], rys[i], 1, 4 + rvs[i]);
    }
    c.globalAlpha = 1;
    // CPS1 foreground trick: a pedestrian crosses IN FRONT of the fight
    const p = t % 620;
    if (p < 150) c.drawImage(walker, VW + 24 - p * 2.9, 136 + ((p >> 2) & 1));
    // and now and then a car rolls past
    const q = (t + 380) % 970;
    if (q < 82) {
      const sx = -140 + q * 6.6;
      c.globalAlpha = 0.08;
      c.fillStyle = '#fff6c8';
      c.fillRect(sx + 130, 192, 26, 3);
      c.fillRect(sx + 130, 194, 48, 6);
      c.globalAlpha = 1;
      c.drawImage(fgcar, sx, 170);
    }
  };

  return { back, props, front };
}

// ---------------- STAGE 2: PUMP HARBOR (dusk docks, mega chart) ----------------
const S2 = {
  bb: 400, // far-space x of the giant candle-chart billboard
  bb2: 780, // far-space x of the smaller billboard
  cranes: [120, 520, 980], // mid-space x of the animated cranes
  warehouses: [300, 900], // mid-space x of the neon warehouses
  lighthouse: 1420, // mid-space x
  seaY: 104, // horizon line in the far layer
};

function s2Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 0, w, 36, '#160f2e');
  R(x, 0, 36, w, 30, '#33204e');
  R(x, 0, 66, w, 24, '#6a2a4e');
  R(x, 0, 90, w, 16, '#c2543a');
  R(x, 0, 100, w, 6, '#e2713a'); // horizon fire
  for (let i = 0; i < 40; i++) R(x, rand(0, w), rand(0, 34), 1, 1, i % 4 ? '#c8b8e8' : '#f5c542');
  // sun sinking into the sea
  disc(x, w * 0.35, S2.seaY, 26, '#8a4a3a');
  disc(x, w * 0.35, S2.seaY, 18, '#f5c542');
  // clouds
  for (let i = 0; i < 12; i++) {
    const cx = rand(0, w);
    const cy = rand(8, 78);
    R(x, cx, cy, rand(24, 56), 4, '#2a1a3e');
    R(x, cx + 6, cy - 3, rand(14, 30), 3, '#3a2450');
    R(x, cx + 2, cy + 4, rand(18, 40), 1, '#6a3a4e'); // lit underbelly
  }
  // distant harbor city (right) with the chart towers
  let bx = w * 0.5;
  while (bx < w) {
    const bw = rand(18, 44);
    const bh = rand(16, 60);
    R(x, bx, S2.seaY - bh, bw, bh, '#0d0a18');
    for (let i = 0; i < 4; i++) {
      if (Math.random() < 0.5) R(x, bx + rand(2, bw - 4), S2.seaY - bh + rand(3, bh - 5), 1, 2, '#b8921f');
    }
    bx += bw + rand(3, 10);
  }
  // chart tower 1 (billboard content is animated in the back pass)
  R(x, S2.bb - 6, 26, 128, S2.seaY - 26, '#0c0916');
  R(x, S2.bb - 2, 20, 4, 8, '#0c0916'); // antenna base
  R(x, S2.bb - 1, 12, 2, 8, '#0c0916');
  R(x, S2.bb - 8, 12, 120, 62, '#14301c'); // green glow frame
  R(x, S2.bb - 6, 14, 116, 58, '#050308'); // plate
  // chart tower 2
  R(x, S2.bb2 - 4, 44, 84, S2.seaY - 44, '#0c0916');
  R(x, S2.bb2 - 5, 34, 78, 42, '#14301c');
  R(x, S2.bb2 - 3, 36, 74, 38, '#050308');
  // the sea
  R(x, 0, S2.seaY, w, VH - S2.seaY, '#101d33');
  R(x, 0, 150, w, VH - 150, '#0c1626');
  // sun glitter column + wave specks (static base; shimmer is animated)
  for (let i = 0; i < 26; i++) {
    R(x, w * 0.35 + rand(-26, 26), S2.seaY + 3 + rand(0, 40), rand(3, 9), 1, Math.random() < 0.5 ? '#e2713a' : '#b8622a');
  }
  for (let i = 0; i < w / 10; i++) R(x, rand(0, w), rand(S2.seaY + 2, 196), rand(4, 12), 1, '#1c3050');
  // distant ship
  R(x, w * 0.12, S2.seaY - 6, 26, 6, '#0d0a18');
  R(x, w * 0.12 + 8, S2.seaY - 12, 8, 6, '#0d0a18');
  return c;
}

function s2Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  // quay wall behind the pier
  R(x, 0, 118, w, 26, '#232833');
  R(x, 0, 118, w, 3, '#39434f');
  for (let bx = 30; bx < w; bx += 90) R(x, bx, 128, 10, 6, '#1a1f28');
  // container stacks on the quay
  const cols = ['#7a3a3a', '#3a6a4a', '#3a4a7a', '#8a6a2a'];
  let bx = 0;
  while (bx < w) {
    const bw = rand(60, 100);
    const stack = 1 + Math.floor(rand(0, 2.4));
    for (let s = 0; s < stack; s++) {
      const col = cols[Math.floor(rand(0, cols.length))];
      R(x, bx, 118 - s * 14 - 14, bw, 14, col);
      R(x, bx, 118 - s * 14 - 14, bw, 2, 'rgba(0,0,0,0.3)');
      for (let rx = bx + 4; rx < bx + bw - 4; rx += 8) R(x, rx, 118 - s * 14 - 12, 2, 10, 'rgba(0,0,0,0.25)');
      if (s === stack - 1 && bw > 74) drawText(x, '1T SUPPLY', bx + 8, 118 - s * 14 - 10, 1, '#e8e4d8');
    }
    bx += bw + rand(10, 30);
  }
  // neon warehouses (signs are animated)
  for (const wx of S2.warehouses) {
    R(x, wx, 62, 190, 56, '#1c1626');
    R(x, wx - 4, 56, 198, 8, '#120e1c'); // roof
    R(x, wx + 60, 84, 60, 34, '#0d0a14'); // cargo door
    R(x, wx + 60, 84, 60, 2, '#241a30');
    for (let i = 0; i < 4; i++) R(x, wx + 12 + i * 12, 72, 7, 6, '#b8860b'); // amber windows
    R(x, wx + 10, 34, 170, 24, '#0a060e'); // neon backplate
    R(x, wx + 10, 34, 170, 2, '#241324');
  }
  // harbor cranes (trolleys + containers are animated)
  for (const crx of S2.cranes) {
    R(x, crx + 16, 30, 12, 90, '#14101f'); // tower
    for (let gy = 36; gy < 118; gy += 12) R(x, crx + 17, gy, 10, 2, '#241c33');
    R(x, crx - 34, 30, 120, 6, '#14101f'); // jib
    R(x, crx - 34, 36, 20, 8, '#14101f'); // counterweight
    R(x, crx + 10, 38, 16, 10, '#1c1626'); // cab
    R(x, crx + 13, 41, 6, 5, '#e2713a'); // cab light
    for (let i = 0; i < 10; i++) R(x, crx - 30 + i * 11, 26 - (i % 2), 8, 4, '#14101f'); // jib truss
  }
  // lighthouse
  const lh = S2.lighthouse;
  R(x, lh, 62, 14, 58, '#d8d4c8');
  R(x, lh, 72, 14, 8, '#a03a3a');
  R(x, lh, 88, 14, 8, '#a03a3a');
  R(x, lh - 2, 54, 18, 8, '#2a2f3a'); // lamp room
  R(x, lh + 2, 48, 10, 6, '#2a2f3a');
  return c;
}

function s2Ground(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84);
  R(x, 0, 0, len, 84, '#5a4632'); // planks base
  for (let py = 4; py < 84; py += 8) {
    R(x, 0, py, len, 1, '#3e2f20');
    for (let nx = (py * 37) % 60; nx < len; nx += 60) R(x, nx, py + 3, 1, 1, '#2e2118');
  }
  R(x, 0, 0, len, 3, '#6e5840');
  R(x, 0, 10, len, 6, '#524026'); // damp band near the water edge
  for (let bx = 80; bx < len; bx += 300) {
    R(x, bx, 2, 8, 10, '#2e2e3c'); // bollard
    R(x, bx - 1, 2, 10, 3, '#4a4a5c');
  }
  // rope coils
  for (let bx = 220; bx < len; bx += 460) {
    disc(x, bx, 22, 6, '#8a6a3a');
    disc(x, bx, 22, 4, '#5a4632');
    disc(x, bx, 22, 2, '#8a6a3a');
  }
  for (let i = 0; i < len / 30; i++) R(x, rand(0, len), rand(10, 80), 3, 1, '#4a3a28');
  for (let mx = 240; mx < len; mx += 620) drawText(x, 'PUMP HARBOR', mx, 52, 1, '#4a3a28');
  return c;
}

function s2Anim(): { back: StageAnim; front: StageAnim } {
  // scrolling green candle chart strip (2 billboard widths, wraps)
  const chartStrip = spr(208, 36, (x) => {
    R(x, 0, 0, 208, 36, '#04140a');
    for (let gy = 8; gy < 36; gy += 9) R(x, 0, gy, 208, 1, '#0d2418');
    let cy = 30;
    for (let cx = 2; cx < 208; cx += 13) {
      const up = Math.random() < 0.78;
      const body = rand(7, 22);
      cy += up ? -rand(1, 5) : rand(1, 4);
      cy = Math.max(6, Math.min(30, cy));
      const col = up ? '#3fae4a' : '#e23b3b';
      R(x, cx + 2, cy - 3, 2, body + 6, col);
      R(x, cx, cy, 7, body, col);
      if (up) R(x, cx, cy, 7, 2, '#7fd858');
    }
  });
  const tapeA = spr(104, 12, (x) => {
    R(x, 0, 0, 104, 12, '#04140a');
    drawText(x, 'GONNA +42%', 4, 3, 1, '#7fd858');
  });
  const tapeB = spr(104, 12, (x) => {
    R(x, 0, 0, 104, 12, '#04140a');
    drawText(x, 'PUMP IT +99%', 4, 3, 1, '#f5c542');
  });
  const arrow = spr(12, 12, (x) => {
    R(x, 5, 0, 2, 8, '#7fd858');
    R(x, 2, 3, 8, 2, '#7fd858');
    R(x, 3, 1, 6, 2, '#7fd858');
    R(x, 4, 8, 4, 4, '#7fd858');
  });
  const neon = (on: boolean): HTMLCanvasElement =>
    spr(170, 24, (x) => {
      R(x, 0, 0, 170, 24, '#0a060e');
      drawText(x, 'PUMP HARBOR', 5, 2, 2, on ? '#ff8a3c' : '#6a3a1a');
      drawText(x, 'NO PAPER HANDS', 22, 17, 1, on ? '#f5c542' : '#5a4a2a');
    });
  const neonOn = neon(true);
  const neonDim = neon(false);
  const containerC = spr(56, 16, (x) => {
    R(x, 0, 0, 56, 16, '#7a3a3a');
    R(x, 0, 0, 56, 2, '#5a2a2a');
    for (let rx = 4; rx < 54; rx += 8) R(x, rx, 2, 2, 14, '#5a2a2a');
    drawText(x, '1T SUPPLY', 2, 5, 1, '#e8e4d8');
  });
  const yacht = spr(156, 46, (x) => {
    R(x, 0, 26, 150, 10, '#e8e4d8'); // hull
    R(x, 150, 28, 6, 8, '#e8e4d8'); // bow
    R(x, 0, 36, 156, 8, '#1a2a4a'); // navy bottom
    R(x, 0, 33, 153, 2, '#f5c542'); // gold stripe
    drawText(x, 'S.S. DIAMOND HANDS', 20, 27, 1, '#12203a');
    R(x, 24, 14, 100, 12, '#d8d4c8'); // main cabin
    R(x, 28, 17, 92, 5, '#0d1a2a'); // window band
    for (let i = 0; i < 8; i++) R(x, 30 + i * 11, 18, 3, 3, '#7ecbff');
    R(x, 48, 6, 56, 8, '#e8e4d8'); // upper deck
    R(x, 52, 8, 48, 3, '#0d1a2a');
    R(x, 76, 0, 3, 6, '#c8ccd4'); // mast
    R(x, 70, 2, 14, 2, '#c8ccd4'); // radar bar
    R(x, 10, 22, 130, 2, '#b8b4a8'); // railing
  });
  const gull = [0, 1].map((f) =>
    spr(9, 4, (x) => {
      x.fillStyle = '#e8e4d8';
      if (f === 0) {
        x.fillRect(0, 1, 3, 1);
        x.fillRect(3, 0, 3, 1);
        x.fillRect(6, 1, 3, 1);
      } else {
        x.fillRect(0, 0, 3, 1);
        x.fillRect(3, 2, 3, 1);
        x.fillRect(6, 0, 3, 1);
      }
    }),
  );
  // sea shimmer streaks (far-space anchors)
  const streaks = new Float32Array(26 * 2);
  for (let i = 0; i < 26; i++) {
    streaks[i * 2] = rand(0, 900);
    streaks[i * 2 + 1] = rand(4, 40);
  }

  const back: StageAnim = (c, camX, t) => {
    const fo = -camX * 0.25;
    const mo = -camX * 0.55;
    // giant candle chart billboards
    const srcX = ((t * 0.5) | 0) % 104;
    const bb = S2.bb + fo;
    if (bb > -120 && bb < VW + 10) {
      c.globalAlpha = 0.1 + 0.05 * Math.sin(t * 0.06);
      c.fillStyle = '#3fae4a';
      c.fillRect(bb - 8, 12, 120, 62);
      c.globalAlpha = 1;
      c.drawImage(chartStrip, srcX, 0, 104, 36, bb, 18, 104, 36);
      c.drawImage(((t >> 6) & 1) === 0 ? tapeA : tapeB, bb, 58);
      if (((t >> 5) & 1) === 0) c.drawImage(arrow, bb + 108, 4);
    }
    const bb2 = S2.bb2 + fo;
    if (bb2 > -80 && bb2 < VW + 10) {
      c.drawImage(chartStrip, (srcX + 52) % 104, 0, 104, 36, bb2, 40, 68, 32);
    }
    // sea shimmer
    for (let i = 0; i < 26; i++) {
      const sx = streaks[i * 2] + fo;
      if (sx < -14 || sx > VW + 14) continue;
      const near = Math.abs(streaks[i * 2] - 0.35 * 960) < 50;
      c.globalAlpha = 0.35 + 0.4 * hash01(t * 0.4 + i * 3);
      c.fillStyle = near ? '#e2713a' : '#3a5a8a';
      c.fillRect(sx, S2.seaY + streaks[i * 2 + 1], 4 + hash01(t * 0.23 + i) * 8, 1);
    }
    c.globalAlpha = 1;
    // mega-yacht S.S. DIAMOND HANDS, sailing slow (0.5 parallax)
    const yx = 460 + ((t * 0.22) % 1100) - 200 - camX * 0.5;
    if (yx > -170 && yx < VW + 20) {
      const bob = Math.sin(t * 0.045) * 1.5;
      c.drawImage(yacht, yx, 96 + bob);
      if (((t >> 5) & 1) === 0) {
        c.fillStyle = '#ff5a5a';
        c.fillRect(yx + 77, 94 + bob, 2, 2);
      }
    }
    // warehouse neon
    for (let wi = 0; wi < S2.warehouses.length; wi++) {
      const wx = S2.warehouses[wi] + mo;
      if (wx < -180 || wx > VW + 10) continue;
      const r = hash01((t >> 2) * 5 + wi * 17);
      if (r < 0.94) {
        c.globalAlpha = 0.1 + 0.05 * hash01(t * 0.8 + wi);
        c.fillStyle = '#ff8a3c';
        c.fillRect(wx + 4, 30, 182, 32);
        c.globalAlpha = 1;
        c.drawImage(neonOn, wx + 10, 34);
      } else c.drawImage(neonDim, wx + 10, 34);
    }
    // crane trolleys + swinging 1T containers
    for (let ci = 0; ci < S2.cranes.length; ci++) {
      const crx = S2.cranes[ci] + mo;
      if (crx < -120 || crx > VW + 40) continue;
      const trx = crx - 20 + (Math.sin(t * 0.008 + ci * 1.7) * 0.5 + 0.5) * 70;
      const cy = 64 + Math.sin(t * 0.02 + ci) * 9;
      c.fillStyle = '#0d0a14';
      c.fillRect(trx, 36, 1, cy - 36);
      c.drawImage(containerC, trx - 28 + Math.sin(t * 0.03 + ci) * 2, cy);
    }
    // lighthouse lamp
    const lhx = S2.lighthouse + mo;
    if (lhx > -30 && lhx < VW + 10 && ((t >> 6) & 1) === 0) {
      c.globalAlpha = 0.5;
      c.fillStyle = '#fff6d8';
      c.fillRect(lhx + 1, 56, 12, 4);
      c.globalAlpha = 0.12;
      c.fillRect(lhx - 26, 57, 26, 2);
      c.fillRect(lhx + 14, 57, 26, 2);
      c.globalAlpha = 1;
    }
  };

  const front: StageAnim = (c, camX, t) => {
    void camX;
    for (let gi = 0; gi < 4; gi++) {
      const gx = ((t * (0.4 + gi * 0.11) + gi * 167) % (VW + 90)) - 45;
      const gy = 30 + gi * 13 + Math.sin(t * 0.05 + gi * 2) * 6;
      c.drawImage(gull[(t >> 3) & 1], gx, gy);
    }
  };

  return { back, front };
}

// ---------------- STAGE 3: BYZANTINE WALL STREET ----------------
const S3 = {
  tickers: [
    { x: 70, y: 44, w: 210 },
    { x: 620, y: 58, w: 240 },
  ], // mid-space
  statues: [
    { x: 430, bull: true },
    { x: 1010, bull: false },
  ], // world x
  lamps: [180, 700, 1300], // world x
  candles: [80, 230, 380, 530, 680, 830], // 0.3-space x of the giant sky candles
};

function s3Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 0, w, 50, '#140a26');
  R(x, 0, 50, w, 50, '#1e0f36');
  R(x, 0, 100, w, 60, '#2a1544');
  R(x, 0, 160, w, 64, '#160d28');
  for (let i = 0; i < 90; i++) {
    R(x, rand(0, w), rand(0, 110), 1, 1, i % 4 === 0 ? '#f5c542' : i % 3 ? '#c8b8e8' : '#6a5a9a');
  }
  // pale gold moon
  disc(x, w * 0.82, 30, 17, '#241536');
  disc(x, w * 0.82, 30, 13, '#e8d8a8');
  disc(x, w * 0.82 - 4, 26, 3, '#c8b888');
  // thin clouds
  for (let i = 0; i < 8; i++) R(x, rand(0, w), rand(20, 90), rand(30, 70), 3, '#241240');
  // distant skyline with the domed exchange
  let bx = 0;
  while (bx < w) {
    const bw = rand(22, 52);
    const bh = rand(24, 66);
    R(x, bx, 150 - bh, bw, bh + 74, '#0d0718');
    for (let i = 0; i < 5; i++) {
      if (Math.random() < 0.4) R(x, bx + rand(2, bw - 3), 150 - bh + rand(3, bh - 4), 1, 2, '#b8921f');
    }
    bx += bw + rand(4, 12);
  }
  // domed exchange silhouette
  const dx = w * 0.45;
  R(x, dx - 40, 110, 80, 40, '#0d0718');
  disc(x, dx, 110, 26, '#0d0718');
  R(x, dx - 2, 76, 4, 12, '#0d0718');
  R(x, dx - 1, 72, 2, 4, '#f5c542'); // spire light
  return c;
}

function s3Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 16, w, 126, '#1c1226'); // wall behind
  // continuous byzantine mosaic frieze
  R(x, 0, 20, w, 10, '#6a4a10');
  for (let mx = 0; mx < w; mx += 12) {
    R(x, mx + 3, 22, 6, 6, (mx / 12) % 2 ? '#1e6b2a' : '#7a2a4a');
    R(x, mx + 5, 23, 2, 4, '#f5c542');
  }
  // marble facades with fluted columns and pediments
  for (let bx = 0; bx < w; bx += 330) {
    R(x, bx + 6, 30, 306, 100, '#4a3f58'); // facade body
    R(x, bx + 6, 126, 306, 14, '#5a5064'); // steps
    R(x, bx + 6, 124, 306, 2, '#8a8095');
    // pediment (stepped)
    R(x, bx + 66, 24, 186, 8, '#5a5064');
    R(x, bx + 96, 18, 126, 6, '#5a5064');
    R(x, bx + 126, 12, 66, 6, '#5a5064');
    drawText(x, '$G', bx + 148, 13, 1, '#f5c542');
    // entablature with mosaic diamonds
    R(x, bx + 6, 34, 306, 10, '#6a5f74');
    for (let mx = bx + 10; mx < bx + 306; mx += 12) {
      R(x, mx + 2, 36, 6, 6, '#b8860b');
      R(x, mx + 4, 38, 2, 2, '#1e6b2a');
    }
    // fluted columns
    for (let cx = bx + 22; cx < bx + 300; cx += 56) {
      R(x, cx, 44, 18, 82, '#d8d0c0');
      R(x, cx, 44, 5, 82, '#b8b0a0'); // shade
      for (let fx = cx + 8; fx < cx + 18; fx += 4) R(x, fx, 46, 1, 78, '#a89f8e'); // flutes
      R(x, cx - 3, 38, 24, 6, '#b8860b'); // gold capital
      R(x, cx - 2, 124, 22, 4, '#9a93a8'); // base
    }
  }
  // ticker backplates (content scrolls in the back pass)
  for (const tk of S3.tickers) {
    R(x, tk.x - 4, tk.y - 3, tk.w + 8, 18, '#06040c');
    R(x, tk.x - 4, tk.y - 3, tk.w + 8, 1, '#b8860b');
    R(x, tk.x - 4, tk.y + 14, tk.w + 8, 1, '#b8860b');
  }
  // WAGMI banners between facades
  for (let bx = 290; bx < w; bx += 660) {
    R(x, bx, 60, 26, 44, '#7a1a2a');
    R(x, bx, 60, 26, 3, '#f5c542');
    R(x, bx, 101, 26, 3, '#f5c542');
    drawText(x, '$G', bx + 6, 74, 2, '#f5c542');
  }
  return c;
}

function s3Ground(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84);
  R(x, 0, 0, len, 84, '#b8b4a8'); // marble
  for (let i = 0; i < len / 14; i++) R(x, rand(0, len), rand(0, 84), rand(6, 20), 1, '#a8a498');
  for (let gx = 0; gx < len; gx += 48) R(x, gx, 0, 1, 84, '#9a968a');
  R(x, 0, 0, len, 2, '#8a867a');
  // red carpet with gold trim
  R(x, 0, 22, len, 40, '#7a1a2a');
  R(x, 0, 22, len, 3, '#f5c542');
  R(x, 0, 59, len, 3, '#f5c542');
  for (let dx = 12; dx < len; dx += 48) {
    R(x, dx, 38, 8, 8, '#93222f');
    R(x, dx + 2, 40, 4, 4, '#b8860b');
  }
  // scattered gold coins pressed into the carpet
  for (let i = 0; i < len / 130; i++) {
    const cx = rand(0, len);
    const cy = rand(26, 56);
    R(x, cx, cy, 4, 3, '#f5c542');
    R(x, cx + 1, cy, 2, 1, '#fff6d8');
  }
  return c;
}

function s3Anim(len: number): { back: StageAnim; props: StageAnim; front: StageAnim } {
  // golden ticker strip (seamless wrap)
  const segs: [string, string][] = [
    ['GONNA +42%', '#7fd858'],
    ['ALGO +8%', '#3fae4a'],
    ['FUD -99%', '#e23b3b'],
    ['WAGMI', '#f5c542'],
    ['BTC +3%', '#7fd858'],
    ['HODL OR DIE', '#f5c542'],
    ['SILVIO INDEX +7%', '#3fae4a'],
  ];
  let stripW = 0;
  for (const s of segs) stripW += s[0].length * 6 + 24;
  const strip = spr(stripW, 12, (x) => {
    R(x, 0, 0, stripW, 12, '#06040c');
    let ox = 0;
    for (const s of segs) {
      drawText(x, s[0], ox, 3, 1, s[1]);
      ox += s[0].length * 6;
      drawText(x, '>', ox + 6, 3, 1, '#b8860b');
      ox += 24;
    }
  });
  const bull = spr(52, 58, (x) => {
    R(x, 8, 44, 36, 14, '#9a93a8'); // pedestal
    R(x, 4, 40, 44, 5, '#b8b0c0');
    // charging bull, head down, gold
    R(x, 16, 22, 24, 14, '#f5c542'); // body
    R(x, 16, 32, 24, 4, '#b8860b'); // belly shade
    R(x, 24, 18, 10, 6, '#f5c542'); // hump
    R(x, 8, 26, 10, 9, '#f5c542'); // lowered head
    R(x, 8, 33, 6, 4, '#b8860b'); // snout
    R(x, 3, 20, 5, 3, '#fff6d8'); // horns
    R(x, 5, 17, 3, 4, '#fff6d8');
    R(x, 11, 21, 3, 3, '#fff6d8');
    R(x, 9, 28, 2, 2, '#101018'); // eye
    R(x, 18, 36, 4, 8, '#d8a832'); // legs
    R(x, 26, 36, 4, 8, '#d8a832');
    R(x, 34, 36, 4, 8, '#d8a832');
    R(x, 38, 36, 4, 8, '#b8860b');
    R(x, 40, 18, 2, 8, '#f5c542'); // tail up
    R(x, 40, 16, 4, 3, '#b8860b');
  });
  const bear = spr(44, 62, (x) => {
    R(x, 4, 48, 36, 14, '#9a93a8'); // pedestal
    R(x, 0, 44, 44, 5, '#b8b0c0');
    // rearing bear, gold
    R(x, 14, 18, 16, 26, '#f5c542'); // body
    R(x, 24, 18, 6, 26, '#b8860b'); // shade
    R(x, 16, 8, 12, 11, '#f5c542'); // head
    R(x, 20, 15, 7, 4, '#b8860b'); // snout
    R(x, 22, 16, 2, 2, '#101018'); // nose
    R(x, 16, 6, 4, 4, '#f5c542'); // ears
    R(x, 25, 6, 4, 4, '#f5c542');
    R(x, 18, 11, 2, 2, '#101018'); // eyes
    R(x, 25, 11, 2, 2, '#101018');
    R(x, 8, 20, 6, 15, '#f5c542'); // raised arms
    R(x, 30, 20, 6, 15, '#d8a832');
    R(x, 8, 18, 6, 3, '#fff6d8'); // claws
    R(x, 30, 18, 6, 3, '#fff6d8');
    R(x, 16, 44, 5, 4, '#d8a832'); // legs
    R(x, 24, 44, 5, 4, '#b8860b');
  });
  const lamp = spr(16, 64, (x) => {
    R(x, 6, 16, 4, 44, '#2a2f3a'); // post
    R(x, 4, 58, 8, 4, '#3a3f4c'); // base
    R(x, 5, 24, 6, 2, '#b8860b'); // ornament rings
    R(x, 5, 40, 6, 2, '#b8860b');
    R(x, 2, 4, 12, 12, '#b8860b'); // lamp head
    R(x, 4, 6, 8, 8, '#fff6d8');
    R(x, 6, 0, 4, 4, '#b8860b'); // finial
  });
  void len;

  const back: StageAnim = (c, camX, t) => {
    const mo = -camX * 0.55;
    // live golden tickers
    for (let ti = 0; ti < S3.tickers.length; ti++) {
      const tk = S3.tickers[ti];
      const sx = tk.x + mo;
      if (sx > VW || sx + tk.w < 0) continue;
      const off = ((t * (0.7 + ti * 0.23)) | 0) % stripW;
      const first = Math.min(tk.w, stripW - off);
      c.drawImage(strip, off, 0, first, 12, sx, tk.y, first, 12);
      if (first < tk.w) c.drawImage(strip, 0, 0, tk.w - first, 12, sx + first, tk.y, tk.w - first, 12);
    }
    // giant candles rising through the purple sky (0.3 parallax)
    const co = -camX * 0.3;
    for (let ci = 0; ci < S3.candles.length; ci++) {
      const sx = S3.candles[ci] + co + Math.sin(t * 0.03 + ci) * 2;
      if (sx < -20 || sx > VW + 20) continue;
      const cy = 160 - ((t * 0.35 + ci * 67) % 180);
      if (cy < -34) continue;
      const up = ci % 5 !== 3;
      const h = 14 + ((ci * 7) % 12);
      const col = up ? '#3fae4a' : '#e23b3b';
      c.fillStyle = col;
      c.fillRect(sx + 4, cy - 5, 2, h + 10);
      c.fillRect(sx, cy, 10, h);
      if (up) {
        c.fillStyle = '#7fd858';
        c.fillRect(sx, cy, 10, 2);
      }
    }
  };

  const props: StageAnim = (c, camX, t) => {
    // Bull & Bear statues
    for (const st of S3.statues) {
      const sx = st.x - camX;
      if (sx < -60 || sx > VW + 10) continue;
      if (st.bull) c.drawImage(bull, sx, 82);
      else c.drawImage(bear, sx, 78);
    }
    // lampposts dripping coins
    for (let li = 0; li < S3.lamps.length; li++) {
      const lx = S3.lamps[li] - camX;
      if (lx < -20 || lx > VW + 20) continue;
      c.globalAlpha = 0.12 + 0.04 * Math.sin(t * 0.05 + li);
      c.fillStyle = '#f5c542';
      c.fillRect(lx - 4, 74, 24, 24);
      c.globalAlpha = 1;
      c.drawImage(lamp, lx, 76);
      for (let ci = 0; ci < 2; ci++) {
        const fall = (t * 1.3 + li * 47 + ci * 71) % 52;
        if (fall < 46) {
          c.fillStyle = '#f5c542';
          c.fillRect(lx + 6 + (ci * 5) % 3, 84 + fall, 3, 3);
          c.fillStyle = '#fff6d8';
          c.fillRect(lx + 7 + (ci * 5) % 3, 85 + fall, 1, 1);
        } else if (((t >> 1) & 1) === 0) {
          c.fillStyle = '#fff6d8';
          c.fillRect(lx + 6, 138, 5, 1);
          c.fillRect(lx + 8, 136, 1, 5);
        }
      }
    }
    // red-carpet stanchions with velvet rope
    const start = Math.floor(camX / 130) * 130;
    for (let k = 0; k < 5; k++) {
      const wx = start + k * 130;
      const sx = wx - camX;
      if (sx < -140 || sx > VW + 10) continue;
      c.fillStyle = '#b8860b';
      c.fillRect(sx, 134, 3, 12);
      c.fillStyle = '#f5c542';
      c.fillRect(sx - 1, 132, 5, 3);
      if (sx + 130 < VW + 10) {
        c.fillStyle = '#7a1a2a';
        for (let r = 0; r < 8; r++) {
          c.fillRect(sx + 3 + r * 16, 137 + Math.sin((r / 7) * Math.PI) * 3, 16, 1);
        }
      }
    }
  };

  const front: StageAnim = (c, camX, t) => {
    void camX;
    // gold dust motes
    c.fillStyle = '#f5c542';
    for (let i = 0; i < 10; i++) {
      c.globalAlpha = 0.25 + 0.5 * hash01(t * 0.6 + i * 13);
      c.fillRect((i * 97 + t * 0.25) % (VW + 20) - 10 + Math.sin(t * 0.04 + i) * 6, 24 + ((i * 53 + t * 0.3) % 130), 1, 1);
    }
    c.globalAlpha = 1;
  };

  return { back, props, front };
}

// ---------------- STAGE 4: TEMPLE OF CONSENSUS ----------------
const S4 = {
  lanterns: [200, 560, 920, 1280], // 0.85-space x
  pond: 480, // world x (220 wide)
  founder: 1150, // world x of the veiled Founder statue
  braziers: [1104, 1216], // world x, flanking the statue
  burners: [260, 860, 1560], // world x incense burners
};

function s4Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 0, w, 100, '#070716');
  R(x, 0, 100, w, 124, '#0d0d22');
  for (let i = 0; i < 80; i++) R(x, rand(0, w), rand(0, 92), 1, 1, i % 3 ? '#c8b8e8' : '#6a5a9a');
  // full moon
  disc(x, w * 0.3, 36, 19, '#15152e');
  disc(x, w * 0.3, 36, 15, '#e8e4f8');
  disc(x, w * 0.3 - 4, 32, 4, '#c8c4e0');
  // thin drifting clouds
  for (let i = 0; i < 6; i++) R(x, rand(0, w), rand(14, 70), rand(36, 70), 3, '#151530');
  // distant pagoda roofs
  for (let tx = 40; tx < w; tx += 340) {
    R(x, tx, 96, 90, 44, '#141428');
    R(x, tx - 12, 90, 114, 8, '#1c1c38');
    R(x, tx + 20, 66, 50, 26, '#141428');
    R(x, tx + 8, 60, 74, 8, '#1c1c38');
    R(x, tx + 40, 48, 10, 14, '#1c1c38');
    for (let wx = tx + 8; wx < tx + 82; wx += 16) {
      if (Math.random() < 0.5) R(x, wx, 108, 6, 8, '#f5c542');
    }
  }
  // torii gate silhouette
  const gx = w * 0.72;
  R(x, gx, 92, 6, 48, '#12122a');
  R(x, gx + 44, 92, 6, 48, '#12122a');
  R(x, gx - 8, 86, 66, 6, '#12122a');
  R(x, gx - 2, 98, 54, 4, '#12122a');
  return c;
}

function s4Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 20, w, 122, '#1c1224'); // temple wall
  R(x, 0, 20, w, 8, '#120a18'); // great beam
  R(x, 0, 26, w, 2, '#b8860b'); // gold beam trim
  // golden mosaic band (the traveling light animates over it)
  R(x, 0, 40, w, 24, '#8a6a1a');
  for (let mx = 0; mx < w; mx += 12) {
    R(x, mx + 2, 43, 8, 18, (mx / 12) % 2 ? '#1e6b2a' : '#7a2a4a');
    R(x, mx + 4, 46, 4, 12, '#b8860b');
    R(x, mx + 5, 49, 2, 6, '#f5c542');
  }
  R(x, 0, 40, w, 2, '#f5c542');
  R(x, 0, 62, w, 2, '#f5c542');
  // Founder mural: great halo behind the altar center
  const hx = w * 0.5;
  disc(x, hx, 96, 30, '#6a4a10');
  disc(x, hx, 96, 24, '#8a6a1a');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    R(x, hx + Math.cos(a) * 34 - 1, 96 + Math.sin(a) * 34 - 1, 3, 3, '#b8860b');
  }
  drawText(x, 'GM', hx - 8, 90, 2, '#f5c542');
  // shoji screens
  for (let sx = 90; sx < w; sx += 300) {
    R(x, sx, 74, 60, 56, '#d8d4c8');
    R(x, sx, 74, 60, 3, '#6b4a2a');
    R(x, sx, 127, 60, 3, '#6b4a2a');
    for (let gx2 = sx + 14; gx2 < sx + 60; gx2 += 15) R(x, gx2, 74, 2, 56, '#6b4a2a');
    R(x, sx, 98, 60, 2, '#6b4a2a');
    R(x, sx + 6, 82, 10, 10, '#fff6d8'); // lantern glow through paper
  }
  // dark lacquer columns with gold capitals
  for (let cx = 30; cx < w; cx += 150) {
    R(x, cx - 4, 132, 34, 8, '#3a2a20');
    R(x, cx, 36, 26, 98, '#2a0f14');
    R(x, cx, 36, 6, 98, '#1c0a0e');
    R(x, cx + 20, 36, 4, 98, '#3a1a20');
    R(x, cx - 4, 30, 34, 8, '#b8860b');
    R(x, cx - 2, 26, 30, 4, '#f5c542');
  }
  return c;
}

function s4Ground(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84);
  // marble checkerboard
  const s = 21;
  for (let gy = 0; gy < 84; gy += s) {
    for (let gx = 0; gx < len; gx += s) {
      R(x, gx, gy, s, s, ((gx / s + gy / s) & 1) ? '#b8b4c8' : '#78748a');
    }
  }
  R(x, 0, 0, len, 2, '#5a5668');
  R(x, 0, 2, len, 4, '#9a96b0'); // polished sheen
  // gold inlay lane markers
  for (let dx = 10; dx < len; dx += 84) {
    R(x, dx, 41, 6, 2, '#b8860b');
    R(x, dx + 2, 39, 2, 6, '#b8860b');
  }
  for (let i = 0; i < len / 40; i++) R(x, rand(0, len), rand(4, 80), 2, 1, 'rgba(0,0,0,0.18)');
  return c;
}

function s4Anim(midW: number): { back: StageAnim; props: StageAnim; front: StageAnim } {
  const lantern = spr(18, 30, (x) => {
    R(x, 8, 0, 2, 8, '#4a3a20'); // cord
    R(x, 5, 7, 8, 3, '#7a5a10'); // cap
    R(x, 2, 10, 14, 14, '#e8b83a'); // paper body
    R(x, 2, 10, 14, 2, '#b8860b');
    R(x, 2, 22, 14, 2, '#b8860b');
    R(x, 6, 10, 1, 14, '#b8860b'); // ribs
    R(x, 11, 10, 1, 14, '#b8860b');
    R(x, 5, 13, 8, 8, '#fff6d8'); // glow core
    R(x, 8, 24, 2, 5, '#e23b3b'); // tassel
  });
  const koi = ['#e2713a', '#e8e4d8', '#f5c542'].map((col) =>
    spr(11, 6, (x) => {
      R(x, 2, 1, 7, 4, col); // body
      R(x, 8, 2, 3, 3, col); // head
      R(x, 0, 2, 2, 2, '#b8622a'); // tail
      R(x, 3, 4, 5, 1, '#fff6d8'); // belly
      R(x, 9, 2, 1, 1, '#101018'); // eye
    }),
  );
  const pond = spr(226, 28, (x) => {
    R(x, 3, 4, 220, 22, '#102438');
    R(x, 8, 8, 210, 14, '#0b1a2a');
    R(x, 30, 10, 8, 4, '#1e6b2a'); // lily pads
    R(x, 180, 16, 9, 4, '#2a7a3a');
    R(x, 70, 8, 22, 1, '#233850'); // moon glints
    R(x, 130, 14, 16, 1, '#233850');
    // stone rim
    let sx = 0;
    while (sx < 226) {
      const sw2 = rand(6, 12);
      R(x, sx, 0, sw2, 5, sx % 3 ? '#6a7280' : '#8a8f9c');
      R(x, sx + 2, 24, sw2, 4, '#5a6270');
      sx += sw2;
    }
  });
  const founder = spr(60, 70, (x) => {
    disc(x, 27, 15, 12, '#f5c542'); // halo ring
    disc(x, 27, 15, 9, '#8a6a1a');
    R(x, 6, 56, 48, 14, '#8a8496'); // pedestal
    R(x, 2, 52, 56, 6, '#9a93a8');
    R(x, 10, 60, 40, 2, '#6a6478'); // pedestal groove
    // veiled robed figure
    R(x, 22, 10, 10, 10, '#d8b030'); // veiled head
    R(x, 24, 13, 6, 6, '#6a4a10'); // face in shadow
    R(x, 18, 12, 4, 22, '#b8921f'); // veil drapes
    R(x, 32, 12, 4, 22, '#b8921f');
    R(x, 20, 20, 14, 6, '#c9a227'); // shoulders
    R(x, 17, 26, 20, 10, '#c9a227'); // robe
    R(x, 15, 36, 24, 16, '#c9a227'); // robe widening
    R(x, 28, 22, 6, 30, '#8a6a1a'); // shade side
    R(x, 18, 26, 2, 26, '#f5c542'); // highlight fold
    R(x, 23, 28, 2, 22, '#a8861e'); // robe folds
    R(x, 30, 28, 2, 22, '#a8861e');
    R(x, 22, 30, 10, 7, '#b8921f'); // joined hands
    R(x, 25, 31, 4, 4, '#f5c542'); // holding a gold coin
    // coin offerings on the pedestal
    R(x, 12, 54, 4, 3, '#f5c542');
    R(x, 40, 54, 4, 3, '#f5c542');
    R(x, 26, 53, 4, 3, '#fff6d8');
  });
  const brazier = spr(14, 12, (x) => {
    R(x, 1, 4, 12, 6, '#6a4a2a');
    R(x, 0, 3, 14, 3, '#8a6a3a');
    R(x, 5, 10, 4, 2, '#4a3018');
    R(x, 3, 4, 8, 2, '#ff8a3c'); // coals
  });
  const puff = puffSprite();

  const back: StageAnim = (c, camX, t) => {
    const mo = -camX * 0.55;
    // golden light traveling across the mosaic band
    const lx = ((t * 0.9) % (midW + 240)) - 120 + mo;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.16;
    c.fillStyle = '#f5c542';
    c.fillRect(lx, 40, 26, 24);
    c.globalAlpha = 0.1;
    c.fillRect(lx - 14, 40, 12, 24);
    c.fillRect(lx + 26, 40, 12, 24);
    c.restore();
    // swaying lanterns (0.85 parallax)
    const lo = -camX * 0.85;
    for (let li = 0; li < S4.lanterns.length; li++) {
      const sx = S4.lanterns[li] + lo;
      if (sx < -24 || sx > VW + 24) continue;
      c.globalAlpha = 0.1 + 0.05 * Math.sin(t * 0.08 + li);
      c.fillStyle = '#f5c542';
      c.fillRect(sx - 6, 26, 30, 40);
      c.globalAlpha = 1;
      c.save();
      c.translate(sx + 9, 24);
      c.rotate(Math.sin(t * 0.045 + li * 1.3) * 0.1);
      c.drawImage(lantern, -9, 0);
      c.restore();
    }
  };

  const props: StageAnim = (c, camX, t) => {
    // koi pond
    const px = S4.pond - camX;
    if (px > -230 && px < VW + 10) {
      c.drawImage(pond, px, 122);
      for (let ki = 0; ki < 3; ki++) {
        const ph = t * 0.011 + ki * 2.2;
        const kx = px + 14 + (Math.sin(ph) * 0.5 + 0.5) * 190;
        const ky = 128 + ki * 5 + Math.sin(t * 0.07 + ki) * 2;
        if (Math.cos(ph) >= 0) {
          c.save();
          c.translate(kx + 11, 0);
          c.scale(-1, 1);
          c.drawImage(koi[ki], 0, ky);
          c.restore();
        } else c.drawImage(koi[ki], kx, ky);
      }
      for (let ri = 0; ri < 2; ri++) {
        const rr = (t * 0.5 + ri * 33) % 44;
        c.globalAlpha = 0.4 * (1 - rr / 44);
        c.strokeStyle = '#3a5a80';
        c.lineWidth = 1;
        c.beginPath();
        c.ellipse(px + 50 + ri * 110, 134, rr * 0.5, rr * 0.16, 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
    // veiled Founder statue with flanking braziers
    const fx = S4.founder - camX;
    if (fx > -80 && fx < VW + 20) {
      c.globalAlpha = 0.1 + 0.05 * Math.sin(t * 0.04);
      c.fillStyle = '#f5c542';
      c.fillRect(fx + 6, 62, 48, 34);
      c.globalAlpha = 1;
      c.drawImage(founder, fx, 70);
      for (let bi = 0; bi < S4.braziers.length; bi++) {
        const bx = S4.braziers[bi] - camX;
        c.drawImage(brazier, bx, 128);
        flame(c, bx + 7, 128, t + bi * 31, 0.9);
      }
    }
    // incense burners with rising smoke
    for (let bi = 0; bi < S4.burners.length; bi++) {
      const bx = S4.burners[bi] - camX;
      if (bx < -20 || bx > VW + 20) continue;
      c.drawImage(brazier, bx, 130);
      for (let si = 0; si < 3; si++) {
        const life = (t * 0.45 + si * 22 + bi * 11) % 66;
        c.globalAlpha = 0.3 * (1 - life / 66);
        c.drawImage(puff, bx + 3 + Math.sin((t + si * 17) * 0.06) * 4, 128 - life * 0.7, 8, 8);
      }
      c.globalAlpha = 1;
    }
  };

  const front: StageAnim = (c, camX, t) => {
    void camX;
    // drifting gold leaves
    c.fillStyle = '#e8c84a';
    for (let i = 0; i < 12; i++) {
      c.globalAlpha = 0.3 + 0.4 * hash01(i * 7 + ((t >> 3) % 8));
      c.fillRect((i * 89 + Math.sin(t * 0.03 + i) * 24 + t * 0.1) % VW, 20 + ((i * 47 + t * 0.35) % 170), 2, 1);
    }
    c.globalAlpha = 1;
  };

  return { back, props, front };
}

// ---------------- STAGE 5: THE HOUSE (neon casino, v8 polish) ----------------
function s5Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  // synthwave gradient wall
  R(x, 0, 0, w, 46, '#160a2a');
  R(x, 0, 46, w, 46, '#2a1040');
  R(x, 0, 92, w, 48, '#451a55');
  // neon grid (animated scanlines overlay it)
  x.fillStyle = '#5a2a7a';
  for (let gy = 100; gy < 140; gy += 10) x.fillRect(0, gy, w, 1);
  for (let gx = 0; gx < w; gx += 32) x.fillRect(gx, 92, 1, 48);
  // neon sun with slit stripes
  disc(x, w * 0.62, 76, 22, '#ff5a8a');
  R(x, w * 0.62 - 24, 76, 48, 2, '#451a55');
  R(x, w * 0.62 - 24, 82, 48, 3, '#451a55');
  R(x, w * 0.62 - 24, 89, 48, 3, '#451a55');
  R(x, 0, 140, w, 84, '#1c0e30');
  // hanging light strings (twinkle is animated)
  for (let lx = 0; lx < w; lx += 14) {
    const ly = 8 + Math.abs(((lx * 7) % 20) - 10);
    R(x, lx, ly, 2, 2, lx % 42 === 0 ? '#ff5a8a' : lx % 28 === 0 ? '#7fd858' : '#f5c542');
  }
  return c;
}

function s5Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 60, w, 82, '#241236'); // wall behind machines
  // sign backplate (neon flickers in the back pass)
  R(x, w * 0.5 - 130, 18, 260, 22, '#101018');
  R(x, w * 0.5 - 130, 18, 260, 2, '#ff5a8a');
  R(x, w * 0.5 - 130, 38, 260, 2, '#ff5a8a');
  // slot machine row (reels spin in the back pass)
  for (let sx = 10; sx < w; sx += 74) {
    R(x, sx, 84, 56, 58, '#7a1a2a');
    R(x, sx, 84, 56, 4, '#93222f');
    R(x, sx, 84, 4, 58, '#b8860b');
    R(x, sx + 52, 84, 4, 58, '#b8860b');
    R(x, sx + 8, 92, 40, 16, '#06040c'); // reel window (dark: reels animated)
    R(x, sx + 8, 92, 40, 1, '#3a2a4a');
    R(x, sx + 10, 114, 36, 8, '#b8860b'); // tray
    R(x, sx + 12, 115, 32, 5, '#f5c542');
    R(x, sx + 60, 90, 3, 16, '#c8ccd4'); // lever
    R(x, sx + 58, 86, 7, 6, '#e23b3b');
    R(x, sx + 4, 76, 48, 6, (sx / 74) % 2 ? '#ff5a8a' : '#3fd8d8'); // topper
  }
  // $GONNA chip garlands
  for (let gx = 30; gx < w; gx += 200) {
    R(x, gx, 66, 10, 10, '#f5c542');
    R(x, gx + 2, 68, 6, 6, '#b8860b');
    drawText(x, 'G', gx + 2, 68, 1, '#f5c542');
  }
  // neon floor-edge strip
  R(x, 0, 140, w, 2, '#3fd8d8');
  return c;
}

function s5Ground(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84);
  R(x, 0, 0, len, 84, '#6e1424'); // red carpet
  R(x, 0, 0, len, 3, '#93222f');
  R(x, 0, 81, len, 3, '#4a0e1a');
  R(x, 0, 8, len, 2, '#b8860b');
  R(x, 0, 74, len, 2, '#b8860b');
  for (let dx = 8; dx < len; dx += 32) {
    R(x, dx, 38, 8, 8, '#93222f');
    R(x, dx + 2, 40, 4, 4, '#b8860b');
  }
  for (let i = 0; i < len / 110; i++) {
    const cx = rand(0, len);
    const cy = rand(14, 70);
    R(x, cx, cy, 6, 4, '#f5c542');
    R(x, cx + 1, cy + 1, 4, 2, '#b8860b');
  }
  return c;
}

function s5Anim(midW: number, farW: number): { back: StageAnim; front: StageAnim } {
  // reel strip: 4 symbols stacked (7 / G / $ / coin)
  const reel = spr(12, 64, (x) => {
    R(x, 0, 0, 12, 64, '#06040c');
    drawText(x, '7', 1, 4, 2, '#f5c542');
    drawText(x, 'G', 1, 20, 2, '#7fd858');
    drawText(x, '$', 1, 36, 2, '#ff5a8a');
    disc(x, 6, 56, 5, '#f5c542');
    disc(x, 6, 56, 3, '#b8860b');
  });
  const signOn = spr(260, 22, (x) => {
    R(x, 0, 0, 260, 22, '#101018');
    drawText(x, 'THE HOUSE ALWAYS WINS', 8, 8, 1, '#ff5a8a');
  });
  const signDim = spr(260, 22, (x) => {
    R(x, 0, 0, 260, 22, '#101018');
    drawText(x, 'THE HOUSE ALWAYS WINS', 8, 8, 1, '#6a2440');
  });
  const machines: number[] = [];
  for (let sx = 10; sx < midW; sx += 74) machines.push(sx);

  const back: StageAnim = (c, camX, t) => {
    // livelier synthwave grid: scanlines rolling down the wall
    c.globalAlpha = 0.35;
    c.fillStyle = '#c84aa8';
    for (let k = 0; k < 5; k++) {
      c.fillRect(0, 100 + ((t * 0.5 + k * 9) % 40), VW, 1);
    }
    c.globalAlpha = 1;
    // neon sun pulse (far parallax)
    const sunX = farW * 0.62 - camX * 0.25;
    if (sunX > -40 && sunX < VW + 40) {
      c.globalAlpha = 0.1 + 0.06 * Math.sin(t * 0.05);
      c.fillStyle = '#ff5a8a';
      c.beginPath();
      c.arc(sunX, 76, 27, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
    const mo = -camX * 0.55;
    // sign flicker
    const sgx = midW * 0.5 - 130 + mo;
    if (sgx > -270 && sgx < VW + 10) {
      const r = hash01((t >> 2) * 3);
      c.drawImage(r < 0.93 ? signOn : signDim, sgx, 18);
    }
    // slot machines actually spinning
    for (let mi = 0; mi < machines.length; mi++) {
      const mx = machines[mi] + mo;
      if (mx < -60 || mx > VW + 6) continue;
      c.fillStyle = (((t >> 4) + mi) & 1) === 0 ? '#ff5a8a' : '#3fd8d8';
      c.fillRect(mx + 4, 76, 48, 6); // chasing topper
      const jackpot = mi % 8 === 3 && t % 480 < 100;
      for (let col = 0; col < 3; col++) {
        const sym = jackpot ? 0 : ((t >> 2) * (1 + ((mi + col) % 3)) + mi + col * 2) & 3;
        c.drawImage(reel, 0, sym * 16, 12, 16, mx + 10 + col * 13, 92, 12, 16);
      }
      if (jackpot && ((t >> 2) & 1) === 0) {
        c.fillStyle = '#f5c542';
        c.fillRect(mx + 6, 112, 3, 3);
        c.fillRect(mx + 46, 110, 3, 3);
        c.fillStyle = '#fff6d8';
        c.fillRect(mx + 26, 84, 2, 2);
      }
    }
  };

  const front: StageAnim = (c, camX, t) => {
    void camX;
    // neon confetti motes
    const cols = ['#ff5a8a', '#f5c542', '#3fd8d8'];
    for (let i = 0; i < 8; i++) {
      c.globalAlpha = 0.3 + 0.4 * hash01(t * 0.5 + i * 11);
      c.fillStyle = cols[i % 3];
      c.fillRect((i * 113 + t * 0.3) % VW, 30 + ((i * 61 + t * 0.4) % 150), 2, 2);
    }
    c.globalAlpha = 1;
  };

  return { back, front };
}

// ---------------- STAGE 6: MOON LAUNCHPAD (v8 polish) ----------------
const S6 = {
  crawler: 900, // world x of the service crawler
};

function s6Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 0, w, VH, '#05060f');
  for (let i = 0; i < 130; i++) R(x, rand(0, w), rand(0, 130), 1, 1, i % 4 ? '#c8d4f8' : '#7a8ac8');
  // aurora band near the horizon
  R(x, 0, 118, w, 4, '#0d2a2a');
  R(x, 0, 122, w, 3, '#0a2030');
  // the Moon (big)
  disc(x, w * 0.24, 42, 28, '#0d1020');
  disc(x, w * 0.24, 42, 24, '#d8d4c8');
  disc(x, w * 0.24 - 7, 36, 6, '#b8b4a8');
  disc(x, w * 0.24 + 8, 48, 5, '#b8b4a8');
  disc(x, w * 0.24 - 2, 52, 3, '#a8a498');
  // glowing Earth (halo pulses in the back pass)
  disc(x, w * 0.68, 30, 11, '#3b6fd4');
  disc(x, w * 0.68 - 3, 27, 4, '#3fae4a');
  disc(x, w * 0.68 + 4, 33, 3, '#7fd858');
  disc(x, w * 0.68 + 1, 29, 2, '#e8f4ff'); // cloud glint
  R(x, 0, 128, w, 12, '#101a30');
  R(x, 0, 140, w, 84, '#0a0e1c');
  return c;
}

function s6Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  // GONNA rockets on their gantries (vent smoke is animated)
  for (let rx = 160; rx < w; rx += 620) {
    R(x, rx - 60, 20, 14, 122, '#2a2f3a'); // gantry tower
    for (let gy = 26; gy < 140; gy += 14) R(x, rx - 58, gy, 10, 2, '#4a4f5c');
    R(x, rx - 46, 40, 26, 4, '#2a2f3a');
    R(x, rx - 46, 84, 26, 4, '#2a2f3a');
    // fuel lines to the rocket
    R(x, rx - 20, 96, 20, 2, '#14301c');
    R(x, rx - 20, 104, 20, 2, '#14301c');
    // rocket body
    R(x, rx, 44, 34, 98, '#e8e4d8');
    R(x, rx, 44, 34, 10, '#c8ccd4');
    R(x, rx + 4, 26, 26, 18, '#3fae4a'); // nose cone
    R(x, rx + 10, 16, 14, 10, '#3fae4a');
    R(x, rx + 11, 60, 12, 12, '#101a30'); // window
    R(x, rx + 13, 62, 8, 8, '#7ecbff');
    R(x, rx, 84, 34, 6, '#3fae4a'); // livery
    drawText(x, 'GONNA', rx + 3, 96, 1, '#1e6b2a');
    R(x, rx - 10, 118, 12, 24, '#1e6b2a'); // fins
    R(x, rx + 32, 118, 12, 24, '#1e6b2a');
    R(x, rx + 8, 140, 18, 4, '#8a8f9c'); // engine
  }
  // floodlight poles
  for (let px = 60; px < w; px += 310) {
    R(x, px, 60, 4, 82, '#2a2f3a');
    R(x, px - 6, 54, 16, 8, '#4a4f5c');
    R(x, px - 4, 56, 4, 4, '#fff6d8');
    R(x, px + 4, 56, 4, 4, '#fff6d8');
  }
  // countdown backplate (digits animated in the back pass)
  R(x, w * 0.5 - 46, 28, 96, 20, '#06040c');
  R(x, w * 0.5 - 46, 28, 96, 2, '#5a1a1a');
  R(x, w * 0.5 - 46, 46, 96, 2, '#5a1a1a');
  return c;
}

function s6Ground(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84);
  R(x, 0, 0, len, 84, '#2e323e'); // metal deck
  for (let gx = 0; gx < len; gx += 42) {
    R(x, gx, 0, 2, 84, '#23262f');
    for (let ry = 8; ry < 84; ry += 20) R(x, gx + 6, ry, 2, 2, '#3e4350');
  }
  R(x, 0, 0, len, 3, '#4a4f5c');
  // glowing green cable conduit
  R(x, 0, 60, len, 1, '#14301c');
  for (let gx = 30; gx < len; gx += 90) R(x, gx, 59, 3, 3, '#3fae4a');
  // hazard stripe band
  for (let hx = 0; hx < len; hx += 16) {
    R(x, hx, 76, 8, 6, '#b8860b');
    R(x, hx + 8, 76, 8, 6, '#101018');
  }
  for (let mx = 140; mx < len; mx += 420) drawText(x, 'TO THE MOON', mx, 30, 1, '#3e4350');
  return c;
}

function s6Anim(midW: number, farW: number): { back: StageAnim; props: StageAnim } {
  const puff = puffSprite();
  const crawler = spr(42, 22, (x) => {
    R(x, 2, 8, 38, 10, '#23262f'); // hull
    R(x, 6, 2, 16, 8, '#2e323e'); // cab
    R(x, 8, 4, 8, 4, '#7ecbff'); // cab glass
    R(x, 24, 4, 14, 4, '#4a4f5c'); // cargo arm
    R(x, 2, 16, 38, 4, '#101318'); // tracks
    for (let tx = 4; tx < 40; tx += 6) R(x, tx, 17, 3, 2, '#3e4350');
  });
  const rockets: number[] = [];
  for (let rx = 160; rx < midW; rx += 620) rockets.push(rx);
  const cdX = midW * 0.5 - 42;
  let lastTotal = -1;
  let cdText = 'T-MINUS 09:59';

  const back: StageAnim = (c, camX, t) => {
    const mo = -camX * 0.55;
    // animated countdown (string rebuilt only when the second changes)
    const total = 599 - (((t / 60) | 0) % 600);
    if (total !== lastTotal || t % 30 === 0) {
      lastTotal = total;
      const mm = (total / 60) | 0;
      const ss = total % 60;
      cdText =
        'T-MINUS ' + (mm < 10 ? '0' : '') + mm + (((t >> 4) & 1) === 0 ? ':' : ' ') + (ss < 10 ? '0' : '') + ss;
    }
    const sx = cdX + mo;
    if (sx > -100 && sx < VW + 10) drawText(c, cdText, sx, 35, 1, '#ff5a5a');
    // rockets venting smoke at the base + gantry beacon
    for (let ri = 0; ri < rockets.length; ri++) {
      const rx = rockets[ri] + mo;
      if (rx < -80 || rx > VW + 40) continue;
      if (((t >> 2) & 1) === 0) {
        c.globalAlpha = 0.5;
        c.fillStyle = '#c8d4e8';
        c.fillRect(rx - 8, 138, 8, 2); // side vent jets
        c.fillRect(rx + 36, 138, 8, 2);
        c.globalAlpha = 1;
      }
      for (let pi = 0; pi < 6; pi++) {
        const life = (t * 0.8 + pi * 14) % 80;
        c.globalAlpha = 0.6 * (1 - life / 80);
        const size = 9 + life * 0.14;
        c.drawImage(puff, rx - 14 + pi * 11 + Math.sin((t + pi * 13) * 0.05) * 6, 140 - life * 0.4, size, size);
      }
      c.globalAlpha = 1;
      c.fillStyle = ((t >> 4) & 1) === 0 ? '#ff5a5a' : '#5a1a1a';
      c.fillRect(rx - 58, 16, 3, 3); // beacon
    }
    // Earth glow pulse (far parallax)
    const ex = farW * 0.68 - camX * 0.25;
    if (ex > -40 && ex < VW + 40) {
      c.globalAlpha = 0.08 + 0.05 * Math.sin(t * 0.045);
      c.fillStyle = '#3b6fd4';
      c.beginPath();
      c.arc(ex, 30, 17, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
    // shooting star now and then
    const p = t % 420;
    if (p < 24) {
      const bx = 500 + ((((t / 420) | 0) % 3) * 160) - p * 7 - camX * 0.25;
      const by = 16 + p * 2.4;
      c.fillStyle = '#e8f4ff';
      c.fillRect(bx, by, 2, 2);
      c.globalAlpha = 0.5;
      c.fillRect(bx + 3, by - 1, 5, 1);
      c.globalAlpha = 1;
    }
  };

  const props: StageAnim = (c, camX, t) => {
    const cx = S6.crawler - camX;
    if (cx > -50 && cx < VW + 10) {
      c.drawImage(crawler, cx, 120);
      c.fillStyle = ((t >> 3) & 1) === 0 ? '#ffb03a' : '#5a3a1a';
      c.fillRect(cx + 38, 6, 3, 3); // amber beacon
    }
  };

  return { back, props };
}

// ---------------- stage table ----------------
export function buildStage(idx: number): StageDef {
  if (idx === 0) {
    const len = 1920;
    const an = s1Anim();
    return {
      name: 'STAGE 1',
      sub: 'GHETTO GONNA',
      track: 'stage1',
      len,
      arenaX: len,
      boss: false,
      bossKind: null,
      bossTrack: 'boss',
      waves: [
        { triggerX: 120, spawns: ['gecko', 'gecko'] },
        { triggerX: 500, spawns: ['gecko', 'gecko', 'drone'] },
        { triggerX: 920, spawns: ['drone', 'gecko', 'gecko', 'snek'] },
        { triggerX: 1360, spawns: ['snek', 'gecko', 'drone', 'gecko'] },
      ],
      obstacles: [
        { kind: 'can', x: 320, y: 168, contains: 'coinA' },
        { kind: 'barrel', x: 700, y: 190, contains: 'chicken' },
        { kind: 'crate', x: 1100, y: 160, contains: 'random' },
        { kind: 'safe', x: 1250, y: 180, contains: 'chest' }, // heavy block: break (3 hits) or walk around
        { kind: 'can', x: 1500, y: 196, contains: 'coinG' },
        { kind: 'barrel', x: 1700, y: 172, contains: 'random' },
      ],
      far: s1Far(len * 0.3 + VW),
      mid: s1Mid(len * 0.6 + VW),
      ground: s1Ground(len),
      back: an.back,
      props: an.props,
      front: an.front,
    };
  }
  if (idx === 1) {
    const len = 1920;
    const an = s2Anim();
    return {
      name: 'STAGE 2',
      sub: 'PUMP HARBOR',
      track: 'stage2',
      len,
      arenaX: len,
      boss: false,
      bossKind: null,
      bossTrack: 'boss',
      waves: [
        { triggerX: 120, spawns: ['gecko', 'drone', 'snek'] },
        { triggerX: 500, spawns: ['whale', 'gecko', 'moltov'] }, // v5: first MOLTOTOV SNEK (docks burn nicely)
        { triggerX: 920, spawns: ['snek', 'snek', 'drone', 'gecko', 'moltov'] },
        { triggerX: 1360, spawns: ['whale', 'gecko', 'drone', 'moltov'] },
      ],
      obstacles: [
        { kind: 'crate', x: 300, y: 172, contains: 'chicken' },
        { kind: 'drum', x: 480, y: 176, contains: 'none' }, // explosive: throw into the wave
        { kind: 'can', x: 560, y: 186, contains: 'coinG' }, // whale may hurl this one
        { kind: 'barrel', x: 640, y: 162, contains: 'random' },
        { kind: 'drum', x: 900, y: 168, contains: 'none' },
        { kind: 'barrel', x: 1050, y: 192, contains: 'chest' },
        { kind: 'crate', x: 1420, y: 168, contains: 'coinA' },
        { kind: 'safe', x: 1600, y: 180, contains: 'chest' },
        { kind: 'can', x: 1750, y: 186, contains: 'random' },
      ],
      far: s2Far(len * 0.3 + VW),
      mid: s2Mid(len * 0.6 + VW),
      ground: s2Ground(len),
      back: an.back,
      front: an.front,
    };
  }
  if (idx === 2) {
    const len = 1680;
    const an = s3Anim(len);
    return {
      name: 'STAGE 3',
      sub: 'BYZANTINE WALL STREET',
      track: 'stage3',
      len,
      arenaX: len - VW,
      boss: true,
      bossKind: 'whale',
      bossTrack: 'boss',
      waves: [
        { triggerX: 120, spawns: ['gecko', 'gecko', 'snek'] },
        { triggerX: 480, spawns: ['whale', 'drone', 'drone', 'bull'] }, // v5: first RIOT SHIELD BULL
        { triggerX: 840, spawns: ['whale', 'snek', 'gecko', 'bull'] },
      ],
      obstacles: [
        { kind: 'crate', x: 280, y: 170, contains: 'chicken' },
        { kind: 'drum', x: 420, y: 176, contains: 'none' },
        { kind: 'can', x: 560, y: 188, contains: 'coinG' }, // whale bait near the brute wave
        { kind: 'barrel', x: 620, y: 188, contains: 'random' },
        { kind: 'drum', x: 760, y: 192, contains: 'none' },
        { kind: 'crate', x: 900, y: 164, contains: 'liz' },
        { kind: 'safe', x: 1050, y: 180, contains: 'chest' },
        { kind: 'can', x: 1150, y: 194, contains: 'coinG' },
      ],
      far: s3Far(len * 0.3 + VW),
      mid: s3Mid(len * 0.6 + VW),
      ground: s3Ground(len),
      back: an.back,
      props: an.props,
      front: an.front,
    };
  }
  if (idx === 3) {
    const len = 1680;
    const an = s4Anim(len * 0.6 + VW);
    return {
      name: 'STAGE 4',
      sub: 'TEMPLE OF CONSENSUS',
      track: 'stage4',
      len,
      arenaX: len - VW,
      boss: true,
      bossKind: 'darkgonna',
      bossTrack: 'boss',
      waves: [
        { triggerX: 120, spawns: ['gecko', 'gecko', 'ninja'] },
        { triggerX: 480, spawns: ['ninja', 'ninja', 'gecko', 'cultist'] }, // v5: first FUD CULTIST (never alone)
        { triggerX: 840, spawns: ['ninja', 'gecko', 'snek', 'ninja', 'bull'] },
        { triggerX: 1120, spawns: ['ninja', 'ninja', 'ninja', 'cultist'] },
      ],
      obstacles: [
        { kind: 'barrel', x: 300, y: 172, contains: 'chicken' },
        { kind: 'crate', x: 460, y: 164, contains: 'random' },
        { kind: 'can', x: 640, y: 190, contains: 'coinG' },
        { kind: 'drum', x: 780, y: 176, contains: 'none' },
        { kind: 'barrel', x: 980, y: 192, contains: 'random' },
        { kind: 'crate', x: 1150, y: 168, contains: 'liz' },
        { kind: 'can', x: 1250, y: 186, contains: 'coinA' },
      ],
      far: s4Far(len * 0.3 + VW),
      mid: s4Mid(len * 0.6 + VW),
      ground: s4Ground(len),
      back: an.back,
      props: an.props,
      front: an.front,
    };
  }
  if (idx === 4) {
    const len = 1920;
    const an = s5Anim(len * 0.6 + VW, len * 0.3 + VW);
    return {
      name: 'STAGE 5',
      sub: 'THE HOUSE',
      track: 'stage5',
      len,
      arenaX: len - VW,
      boss: true,
      bossKind: 'golem',
      bossTrack: 'boss',
      waves: [
        { triggerX: 120, spawns: ['coinsnek', 'snek', 'gecko'] },
        { triggerX: 500, spawns: ['bouncer', 'coinsnek', 'moltov'] },
        { triggerX: 920, spawns: ['coinsnek', 'coinsnek', 'snek', 'ninja', 'cultist'] },
        { triggerX: 1360, spawns: ['bouncer', 'bouncer', 'coinsnek', 'bull'] },
      ],
      obstacles: [
        { kind: 'chips', x: 300, y: 172, contains: 'coinG' },
        { kind: 'crate', x: 430, y: 166, contains: 'chicken' },
        { kind: 'chips', x: 600, y: 190, contains: 'chest' },
        { kind: 'can', x: 760, y: 186, contains: 'coinG' },
        { kind: 'chips', x: 1000, y: 168, contains: 'random' },
        { kind: 'safe', x: 1200, y: 180, contains: 'chest' },
        { kind: 'chips', x: 1420, y: 192, contains: 'coinG' },
        { kind: 'barrel', x: 1650, y: 174, contains: 'random' },
      ],
      far: s5Far(len * 0.3 + VW),
      mid: s5Mid(len * 0.6 + VW),
      ground: s5Ground(len),
      back: an.back,
      front: an.front,
    };
  }
  if (idx === 5) {
  const len = 1680;
  const an = s6Anim(len * 0.6 + VW, len * 0.3 + VW);
  return {
    name: 'STAGE 6',
    sub: 'MOON LAUNCHPAD',
    track: 'stage6',
    len,
    arenaX: len - VW,
    boss: true,
    bossKind: 'fud',
    bossTrack: 'boss2',
    waves: [
      { triggerX: 120, spawns: ['ninja', 'coinsnek', 'whale', 'bull'] },
      { triggerX: 440, spawns: ['bouncer', 'ninja', 'drone', 'cultist'] },
      { triggerX: 800, spawns: ['whale', 'coinsnek', 'ninja', 'snek', 'moltov'] },
      { triggerX: 1060, spawns: ['bouncer', 'ninja', 'coinsnek', 'cultist'] },
    ],
    obstacles: [
      { kind: 'drum', x: 280, y: 174, contains: 'none' }, // fuel drums: explosive
      { kind: 'crate', x: 420, y: 166, contains: 'chicken' },
      { kind: 'drum', x: 560, y: 190, contains: 'none' },
      { kind: 'can', x: 700, y: 188, contains: 'coinG' },
      { kind: 'drum', x: 880, y: 172, contains: 'none' },
      { kind: 'safe', x: 1020, y: 180, contains: 'chest' },
      { kind: 'drum', x: 1150, y: 192, contains: 'none' },
      { kind: 'barrel', x: 1250, y: 176, contains: 'random' },
    ],
    far: s6Far(len * 0.3 + VW),
    mid: s6Mid(len * 0.6 + VW),
    ground: s6Ground(len),
    back: an.back,
    props: an.props,
  };
  }
  if (idx === 6) return buildThroneRoom();
  return buildStage(5); // unreachable — keeps the compiler honest
}

// ---------------- STAGE 7: THE THRONE ROOM (v9.5) ----------------
// The candle cathedral above the clouds. A love letter to the Algorand
// community: stained-glass ALGO windows, candlestick columns, the Corridor
// of the Dead (BTC/ETH/SOL relics), the live block-number frieze, the degen
// crowd — and the golden statue YOU minted, waiting on its pedestal.

export const THRONE_FX = {
  rage: false, // phase 3: candles gutter, glitch storm intensifies
  gasp: 0, // frames of crowd shock (statue explosion / NOT FOUND teleport)
};

const S7_PEDESTAL_MID_X = 864; // mid-layer x: aligns with the boss statue at fight time
const S7_WINDOWS_FAR = [320, 430, 540]; // far-layer x of the stained-glass arches

function s7Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  // cathedral depth: violet-black above the clouds
  const grd = x.createLinearGradient(0, 0, 0, VH);
  grd.addColorStop(0, '#0a0714');
  grd.addColorStop(0.65, '#100b20');
  grd.addColorStop(1, '#1a1026');
  x.fillStyle = grd;
  x.fillRect(0, 0, w, VH);
  // clouds below (we are above the world, past the MOON LAUNCHPAD)
  for (let i = 0; i < 10; i++) {
    disc(x, 30 + i * 85, VH - 14 + (i % 3) * 5, 26, '#141026');
    disc(x, 60 + i * 85, VH - 8 + (i % 2) * 4, 20, '#18122e');
  }
  // ---- stained-glass arches: ALGO / GONNA / THE CHART ----
  for (let i = 0; i < S7_WINDOWS_FAR.length; i++) {
    const wx = S7_WINDOWS_FAR[i];
    // arch frame
    R(x, wx - 4, 18, 56, 108, '#241c3a');
    R(x, wx - 1, 21, 50, 102, '#0a0714');
    // glitch sky inside (the storm is animated in the back pass)
    R(x, wx + 1, 23, 46, 98, '#0d0a1e');
    if (i === 0) {
      // ALGORAND pane: green glass triangle-A
      x.strokeStyle = '#1d5c34';
      x.lineWidth = 4;
      x.beginPath();
      x.moveTo(wx + 8, 100);
      x.lineTo(wx + 24, 44);
      x.lineTo(wx + 40, 100);
      x.stroke();
      x.beginPath();
      x.moveTo(wx + 14, 78);
      x.lineTo(wx + 34, 78);
      x.stroke();
      x.fillStyle = '#39ff14';
      x.globalAlpha = 0.35;
      x.fillRect(wx + 1, 23, 46, 98);
      x.globalAlpha = 1;
    } else if (i === 1) {
      // GONNA pane: golden lizard head silhouette
      x.fillStyle = '#8a6518';
      x.fillRect(wx + 10, 50, 26, 34);
      x.fillRect(wx + 26, 58, 12, 12); // snout
      x.fillStyle = '#f5c542';
      x.fillRect(wx + 12, 52, 22, 28);
      x.fillRect(wx + 26, 59, 10, 8);
      x.fillStyle = '#0a0714';
      x.fillRect(wx + 17, 58, 4, 4); // eye
      x.globalAlpha = 0.25;
      x.fillStyle = '#f5c542';
      x.fillRect(wx + 1, 23, 46, 98);
      x.globalAlpha = 1;
    } else {
      // THE CHART pane: green candlesticks in glass
      for (let k = 0; k < 4; k++) {
        const ch = 14 + k * 9;
        R(x, wx + 7 + k * 10, 104 - ch, 6, ch, k === 3 ? '#f5c542' : '#1d8a3e');
        R(x, wx + 9 + k * 10, 100 - ch, 2, ch + 5, k === 3 ? '#f5d76e' : '#2a9d4f');
      }
      x.globalAlpha = 0.3;
      x.fillStyle = '#39ff14';
      x.fillRect(wx + 1, 23, 46, 98);
      x.globalAlpha = 1;
    }
    // leading lines
    x.fillStyle = '#241c3a';
    x.fillRect(wx + 22, 23, 2, 98);
    x.fillRect(wx + 1, 66, 46, 2);
  }
  return c;
}

function s7Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 0, w, 140, '#171226');
  // wall paneling + gold trim
  R(x, 0, 36, w, 3, '#3a2f14');
  R(x, 0, 126, w, 2, '#3a2f14');
  // ---- THE FRIEZE: the living blockchain band ----
  R(x, 0, 8, w, 24, '#0d0a18');
  R(x, 0, 8, w, 2, '#6e5318');
  R(x, 0, 30, w, 2, '#6e5318');
  for (let bx = 10; bx < w; bx += 46) {
    R(x, bx, 13, 14, 14, '#1d1730');
    R(x, bx + 2, 15, 10, 10, '#2c2244');
    R(x, bx + 14, 19, 32, 2, '#4a3a1a'); // the chain link
  }
  // ---- candlestick columns ----
  for (let cx0 = 60; cx0 < w; cx0 += 160) {
    // green candle body as column
    R(x, cx0, 40, 26, 100, '#14542a');
    R(x, cx0 + 2, 40, 4, 100, '#1d8a3e');
    R(x, cx0 + 20, 40, 4, 100, '#0d3a1d');
    // capital + base (gold)
    R(x, cx0 - 5, 36, 36, 5, '#8a6518');
    R(x, cx0 - 5, 138, 36, 5, '#8a6518');
    R(x, cx0 - 3, 36, 32, 2, '#b8860b');
  }
  // ---- tapestries between columns ----
  for (let i = 0; i * 160 + 130 < w; i++) {
    const tx = i * 160 + 130;
    R(x, tx, 44, 44, 76, '#2a0f1e'); // cloth
    R(x, tx, 44, 44, 4, '#6e5318'); // rod
    R(x, tx + 2, 46, 40, 2, '#3a2f14');
    // candle chart motif on the cloth
    for (let k = 0; k < 4; k++) {
      const ch = 8 + ((i * 5 + k * 7) % 22);
      R(x, tx + 7 + k * 9, 104 - ch, 5, ch, '#1d8a3e');
    }
    R(x, tx + 4, 112, 36, 3, '#6e5318'); // hem
  }
  // ---- THE COMPETITION 01 TAPESTRY (near the throne) ----
  R(x, 760, 42, 52, 82, '#241432');
  R(x, 760, 42, 52, 4, '#8a6518');
  for (let k = 0; k < 5; k++) {
    const ch = 10 + k * 8;
    R(x, 767 + k * 9, 108 - ch, 6, ch, k === 4 ? '#f5c542' : '#1d8a3e');
  }
  drawText(x, '218540', 786, 112, 1, '#f5c542', 'center');
  // ---- SOVEREIGN OF GENESIS banner ----
  R(x, 690, 46, 56, 30, '#171208');
  R(x, 690, 46, 56, 2, '#b8860b');
  R(x, 690, 74, 56, 2, '#b8860b');
  drawText(x, 'SOVEREIGN', 718, 52, 1, '#f5c542', 'center');
  drawText(x, 'OF GENESIS', 718, 62, 1, '#b8860b', 'center');
  // ---- THE CORRIDOR OF THE DEAD (inferior chains, fondly remembered) ----
  // ETH: the rusted gas pump
  R(x, 152, 96, 26, 42, '#2c2a26');
  R(x, 156, 100, 18, 12, '#3a3f4c');
  drawText(x, 'GAS', 165, 102, 1, '#8a8f9c', 'center');
  drawText(x, '$48', 165, 116, 1, '#e5484d', 'center');
  R(x, 158, 126, 14, 3, '#4a3a28'); // rust
  R(x, 178, 104, 8, 4, '#2c2a26'); // broken hose
  // SOL: the cracked obelisk
  R(x, 414, 84, 22, 54, '#232030');
  R(x, 414, 84, 22, 4, '#2e2a3c');
  drawText(x, 'SOL', 425, 92, 1, '#5a5f6c', 'center');
  drawText(x, 'OFFLINE', 425, 108, 1, '#e5484d', 'center');
  x.strokeStyle = '#0d0a18';
  x.lineWidth = 1;
  x.beginPath();
  x.moveTo(418, 90);
  x.lineTo(424, 108);
  x.lineTo(420, 126);
  x.stroke();
  // BTC: the stone turtle
  R(x, 616, 122, 30, 14, '#3a3f4c');
  disc(x, 648, 126, 6, '#3a3f4c');
  R(x, 620, 134, 6, 5, '#2c313c');
  R(x, 636, 134, 6, 5, '#2c313c');
  drawText(x, 'BTC', 633, 124, 1, '#8a8f9c', 'center');
  drawText(x, '~10 MIN', 633, 142, 1, '#5a5f6c', 'center');
  // ---- THE THRONE + the statue pedestal ----
  const px = S7_PEDESTAL_MID_X;
  // throne: golden high-back silhouette behind the pedestal
  R(x, px + 34, 44, 44, 96, '#6e5318');
  R(x, px + 38, 48, 36, 88, '#8a6518');
  R(x, px + 42, 52, 28, 80, '#3a2f14');
  disc(x, px + 56, 44, 10, '#b8860b'); // halo crown of the throne
  R(x, px + 44, 84, 24, 4, '#b8860b'); // armrest
  // pedestal (the statue from THE MINTING stands here — the boss intro)
  R(x, px - 34, 156, 68, 8, '#3a2f14');
  R(x, px - 34, 156, 68, 2, '#8a6518');
  R(x, px - 28, 164, 56, 18, '#2c240f');
  R(x, px - 28, 164, 56, 2, '#6e5318');
  return c;
}

function s7Ground(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84);
  R(x, 0, 0, len, 84, '#141020'); // dark marble
  for (let px = 0; px < len; px += 40) {
    R(x, px, 0, 1, 84, '#0d0a18');
    R(x, px + 20, 0, 1, 84, '#100c1c');
  }
  R(x, 0, 28, len, 1, '#0d0a18');
  R(x, 0, 56, len, 1, '#0d0a18');
  // gold inlay veins
  for (let px = 12; px < len; px += 90) {
    R(x, px, 12 + (px % 20), 22, 1, '#4a3a1a');
    R(x, px + 8, 13 + (px % 20), 6, 1, '#8a6518');
  }
  // THE RED CARPET to the throne (walkable band)
  R(x, 0, 18, len, 48, '#4a1020');
  R(x, 0, 18, len, 3, '#8a6518');
  R(x, 0, 63, len, 3, '#8a6518');
  for (let px = 8; px < len; px += 16) {
    R(x, px, 21, 2, 2, '#b8860b'); // carpet studs
    R(x, px, 60, 2, 2, '#b8860b');
  }
  return c;
}

const S7_CROWD_TINTS = ['#6fba3e', '#5ba635', '#7fd858', '#4a7d2a', '#b8db8f', '#428d2a'];
const S7_SIGNS = ['FRIED', '218540', 'SKRRT', 'WAGMI', 'LFG', 'HODL'];

function s7Back(): StageAnim {
  return (c, camX, t) => {
    const gasp = THRONE_FX.gasp > 0;
    const rage = THRONE_FX.rage;

    // ---- glitch storm inside the stained-glass windows ----
    for (let i = 0; i < S7_WINDOWS_FAR.length; i++) {
      const wx = S7_WINDOWS_FAR[i] - camX * 0.25;
      if (wx < -60 || wx > VW + 20) continue;
      // pixel rain
      const drops = rage ? 7 : 4;
      for (let k = 0; k < drops; k++) {
        const dx = wx + 3 + ((k * 17 + i * 31) % 42);
        const dy = 24 + ((t * (1.2 + k * 0.3) + k * 40) % 94);
        c.fillStyle = k % 3 === 0 ? '#3cc9ff' : '#b07eff';
        c.globalAlpha = 0.5;
        c.fillRect(dx, dy, 2, 5);
      }
      c.globalAlpha = 1;
      // floating 404 fragments
      if (((t >> 4) + i) % 3 === 0) {
        const fy = 34 + ((t * 0.4 + i * 30) % 80);
        drawText(c, '404', wx + 24, fy, 1, '#3cc9ff', 'center');
      }
      // buffering blocks
      const buf = (t * 0.6 + i * 53) % 90;
      if (buf < 10) {
        c.globalAlpha = 0.25;
        c.fillStyle = '#8a9bd4';
        c.fillRect(wx + 1, 23 + buf * 9, 46, 6);
        c.globalAlpha = 1;
      }
    }

    // ---- candle wick flames on the columns ----
    for (let cx0 = 60; cx0 < 1500; cx0 += 160) {
      const fx = cx0 + 13 - camX * 0.55;
      if (fx < -20 || fx > VW + 20) continue;
      const h = (rage ? 3 : 6) + Math.sin(t * 0.2 + cx0) * 1.5;
      c.globalAlpha = 0.85;
      disc(c, fx, 34 - h / 2, 2.5, '#ff9d2e');
      c.globalAlpha = 0.5;
      disc(c, fx, 34 - h / 2 - 2, 1.5, '#f5d76e');
      c.globalAlpha = 1;
    }

    // ---- the live frieze: BLOCK <number> counting in real time ----
    const round = latestAlgorandRound();
    const label = round > 0 ? 'BLOCK ' + round.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : 'BLOCK -------';
    // HUD strip owns y0..44 during combat — keep the frieze readout low-right,
    // above the boss HP bar, dimmed so it never fights the HUD for attention
    drawText(c, label, VW - 8, VH - 42, 1, 'rgba(57,255,20,0.8)', 'right');
    drawText(c, 'ALGORAND', 8, VH - 42, 1, 'rgba(110,83,24,0.85)');
    // tiny blocks streaming along the chain (bottom edge, clear of HUD)
    for (let k = 0; k < 4; k++) {
      const bx = VW - ((t * 0.8 + k * 110) % (VW + 40));
      c.fillStyle = '#2c2244';
      c.fillRect(bx, VH - 34, 8, 8);
      c.fillStyle = '#4a3a6e';
      c.fillRect(bx + 1, VH - 33, 6, 6);
    }

    // ---- the degen crowd (GONNAs of every nation of the trench) ----
    c.fillStyle = '#100c1c';
    c.fillRect(0, 134, VW, 6);
    for (let i = 0; i < 15; i++) {
      const cx0 = 14 + i * 26;
      const amp = gasp ? 5 : 2;
      const bounce = Math.abs(Math.round(Math.sin(t * (gasp ? 0.3 : 0.12) + i * 2.1) * amp));
      const by = 134 - bounce;
      c.fillStyle = S7_CROWD_TINTS[i % S7_CROWD_TINTS.length];
      c.fillRect(cx0, by - 9, 7, 9);
      c.fillRect(cx0 + 1, by - 14, 5, 5);
      c.fillRect(cx0 + 5, by - 12, 3, 2); // snout, never a tail
      c.fillStyle = '#0b0d12';
      c.fillRect(cx0 + 2, by - 12, 1, 1);
      if (gasp && i % 3 === 0) drawText(c, '!', cx0 + 3, by - 26, 1, '#f5d76e', 'center');
      if (i % 3 === 1) {
        const word = S7_SIGNS[(i / 3 | 0) % S7_SIGNS.length];
        c.fillStyle = '#8a8f9c';
        c.fillRect(cx0 + 3, by - 26, 1, 13);
        c.fillStyle = i % 6 === 1 ? '#f5c542' : '#e8ecf4';
        c.fillRect(cx0 - 16, by - 37, 40, 11);
        drawText(c, word, cx0 + 4, by - 34, 1, '#101218', 'center');
      }
    }

    // ---- rage: the cathedral holds its breath ----
    if (rage) {
      c.globalAlpha = 0.18;
      c.fillStyle = '#1a0a14';
      c.fillRect(0, 0, VW, 140);
      c.globalAlpha = 1;
      // glitch lightning outside
      if (hash01(t >> 3) > 0.72) {
        c.strokeStyle = '#b07eff';
        c.globalAlpha = 0.7;
        c.lineWidth = 1;
        const lx = hash01(t) * VW;
        c.beginPath();
        c.moveTo(lx, 20);
        c.lineTo(lx + 8, 50);
        c.lineTo(lx - 4, 80);
        c.lineTo(lx + 10, 110);
        c.stroke();
        c.globalAlpha = 1;
      }
    }
  };
}

function s7Front(): StageAnim {
  return (c, camX, t) => {
    // foreground column silhouettes sliding past (cathedral scale)
    const off = -camX * 1.0;
    c.fillStyle = 'rgba(8,6,14,0.9)';
    for (let i = 0; i < 5; i++) {
      const fx = ((i * 420 + off) % 2100 + 2100) % 2100 - 60;
      if (fx > VW || fx + 34 < 0) continue;
      c.fillRect(fx, 0, 34, 140);
      c.fillRect(fx - 5, 0, 44, 8);
    }
    // incense smoke
    const ph = (t * 0.5) % 220;
    if (ph < 80) {
      c.globalAlpha = 0.06 * (1 - ph / 80);
      disc(c, 90 + ph * 0.4, 200 - ph * 0.6, 16, '#c8cdd7');
      disc(c, 300 - ph * 0.3, 205 - ph * 0.5, 13, '#c8cdd7');
      c.globalAlpha = 1;
    }
  };
}

export function buildThroneRoom(): StageDef {
  const len = 1500;
  return {
    name: 'STAGE 7',
    sub: 'THE THRONE ROOM',
    track: 'stage6', // the launchpad theme, requiem mode
    len,
    arenaX: len - VW,
    boss: true,
    bossKind: 'gonna404',
    bossTrack: 'boss2',
    waves: [
      // THE GOLD GUARD — the elite, gilded by the light of the cathedral
      { triggerX: 120, spawns: ['bouncer', 'ninja', 'cultist'] },
      { triggerX: 480, spawns: ['bull', 'ninja', 'coinsnek', 'cultist'] },
      { triggerX: 840, spawns: ['bouncer', 'bull', 'ninja', 'cultist', 'moltov'] },
    ],
    obstacles: [
      { kind: 'can', x: 300, y: 170, contains: 'coinG' },
      { kind: 'safe', x: 620, y: 180, contains: 'chest' },
      { kind: 'barrel', x: 950, y: 175, contains: 'chicken' },
    ],
    far: s7Far(len * 0.3 + VW),
    mid: s7Mid(len * 0.6 + VW),
    ground: s7Ground(len),
    back: s7Back(),
    front: s7Front(),
  };
}


// ---------------- BONUS STAGE: THE MINTING (v9.4) ----------------
// SF2-style static bonus: one obsidian ALGORAND monument on a pedestal in the
// forge. Single-screen arena (camX never moves). Live state flows through
// MINT_FX, written each frame by mint.ts: chart pump, dip, god candle, klaxon,
// crowd hype. The crew is the GONNA roster itself — never random lizards.

export const MINT_FX = {
  chart: 0, // 0..1 — the live candle pumps with your damage
  dip: 0, // 0..1 — red dip while the player stands still
  godCandle: 0, // 0..1 — GOD CANDLE beam when the monument shatters
  klaxon: false, // red alert under 10 seconds
  hype: 0, // 0..1 — crowd/crew excitement (decays)
};

export function resetMintFx(): void {
  MINT_FX.chart = 0;
  MINT_FX.dip = 0;
  MINT_FX.godCandle = 0;
  MINT_FX.klaxon = false;
  MINT_FX.hype = 0;
}

function sMintFar(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  // foundry depth: cold dark above, molten glow below
  const grd = x.createLinearGradient(0, 0, 0, VH);
  grd.addColorStop(0, '#05070d');
  grd.addColorStop(0.7, '#0a0e18');
  grd.addColorStop(1, '#161006');
  x.fillStyle = grd;
  x.fillRect(0, 0, w, VH);
  // distant arch windows breathing chart-green
  for (let i = 0; i < 4; i++) {
    const wx = 40 + i * 130;
    R(x, wx, 46, 26, 44, '#0d2417');
    R(x, wx + 2, 48, 22, 40, '#123a22');
    R(x, wx + 2, 48, 22, 3, '#1d5c34');
    R(x, wx + 11, 48, 2, 40, '#0d2417');
  }
  // THE GOLDFALL: a vertical river of molten gold, right of center
  const fx0 = Math.floor(w * 0.72);
  R(x, fx0, 0, 34, VH, '#6e5318');
  for (let i = 0; i < 9; i++) {
    const sx0 = fx0 + 2 + i * 4;
    R(x, sx0, 0, 2, VH, i % 3 === 0 ? '#f5d76e' : '#b8860b');
  }
  R(x, fx0 - 10, VH - 30, 54, 30, '#8a6518'); // splash pool
  disc(x, fx0 + 17, VH - 22, 22, '#b8860b');
  disc(x, fx0 + 17, VH - 24, 14, '#f5d76e');
  // silhouette machines
  R(x, 0, 96, 70, VH - 96, '#080b12');
  R(x, 120, 116, 44, VH - 116, '#080b12');
  R(x, fx0 + 70, 106, 90, VH - 106, '#080b12');
  return c;
}

function sMintMid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  // wall panels + rivets
  R(x, 0, 0, w, 140, '#12161f');
  for (let px = 0; px < w; px += 48) {
    R(x, px, 0, 1, 140, '#0c0f16');
    R(x, px + 4, 4, 2, 2, '#232a38');
    R(x, px + 4, 134, 2, 2, '#232a38');
  }
  // big gears (static silhouettes, shadows of industry)
  for (const [gx, gy, gr] of [
    [30, 60, 26],
    [356, 54, 22],
  ] as const) {
    disc(x, gx, gy, gr, '#0c0f16');
    disc(x, gx, gy, gr - 8, '#12161f');
    for (let a = 0; a < 8; a++) {
      const tx = gx + Math.cos((a * Math.PI) / 4) * gr;
      const ty = gy + Math.sin((a * Math.PI) / 4) * gr;
      R(x, tx - 3, ty - 3, 6, 6, '#0c0f16');
    }
  }
  // top pipe run (the cat walks here)
  R(x, 0, 14, w, 6, '#1a2030');
  for (let px = 20; px < w; px += 60) R(x, px, 12, 6, 10, '#232a38');
  // ---- THE CHART WALL: bezel + dead screen (the live chart is animated) ----
  R(x, 88, 22, 208, 88, '#232a38');
  R(x, 92, 26, 200, 80, '#040805');
  drawText(x, 'ALGORAND', 192, 8, 2, '#2c3444', 'center');
  // ticker bezel under the chart
  R(x, 88, 112, 208, 14, '#232a38');
  R(x, 92, 114, 200, 10, '#05070a');
  // crew platforms (left + right ledges)
  for (const px0 of [16, 300]) {
    R(x, px0, 118, 68, 6, '#1d2330');
    R(x, px0, 118, 68, 2, '#2c3444');
    R(x, px0 + 8, 124, 4, 16, '#12161f');
    R(x, px0 + 56, 124, 4, 16, '#12161f');
  }
  // engraved plate on the wall
  drawText(x, 'THE MINTING', 192, 132, 1, '#2c3444', 'center');
  return c;
}

function sMintGround(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84);
  R(x, 0, 0, len, 84, '#181c26');
  // metal plates
  for (let px = 0; px < len; px += 32) {
    R(x, px, 0, 1, 84, '#0e1119');
    R(x, px + 16, 20, 1, 44, '#10141d');
  }
  R(x, 0, 20, len, 1, '#0e1119');
  R(x, 0, 64, len, 1, '#0e1119');
  // molten seams glowing through the floor near the monument
  for (let px = 190; px < 320; px += 14) {
    R(x, px, 34 + ((px * 7) % 12), 8, 1, '#6e5318');
    R(x, px + 3, 35 + ((px * 7) % 12), 3, 1, '#f5c542');
  }
  // drain grate
  R(x, 56, 60, 28, 10, '#0c0f16');
  for (let i = 0; i < 6; i++) R(x, 58 + i * 5, 61, 2, 8, '#181c26');
  // front rivets
  for (let px = 8; px < len; px += 24) R(x, px, 76, 2, 2, '#2c3444');
  return c;
}

const MINT_TICKER =
  "$GONNA +69420% * $ALGO +420% * BTC +0.1% (BOOMER) * ETH GAS: $48 * SOL: OFFLINE (AGAIN) * WAGMI * SKRRT SKRRT * ";

const MINT_CREW: { skin: SkinId; x: number; feet: number; hat: boolean; flip: boolean }[] = [
  { skin: 'acid', x: 34, feet: 118, hat: false, flip: false }, // pickaxe shift
  { skin: 'black', x: 64, feet: 118, hat: true, flip: true }, // the foreman
  { skin: 'patriot', x: 318, feet: 118, hat: false, flip: true }, // ingot hauler
  { skin: 'pollution', x: 346, feet: 118, hat: true, flip: false }, // smoke break
  { skin: 'fire', x: 128, feet: 138, hat: false, flip: false }, // feeds the forge
  { skin: 'alien', x: 60, feet: 138, hat: false, flip: false }, // stares at the chart, understands nothing
];

const MINT_CROWD_TINTS = ['#6fba3e', '#5ba635', '#7fd858', '#4a7d2a', '#b8db8f', '#428d2a'];
const MINT_SIGNS = ['WAGMI', 'LFG', 'SKRRT', 'FRIED', '218K', 'HODL', 'GM'];

function sMintBack(): StageAnim {
  return (c, camX, t) => {
    const mo = -camX * 0.55;
    c.save();
    c.translate(Math.round(mo), 0);
    const hype = MINT_FX.hype;

    // ---------- THE CHART WALL (live) ----------
    // grid
    c.fillStyle = '#0d2417';
    for (let gy = 40; gy < 100; gy += 15) c.fillRect(94, gy, 196, 1);
    // history candles (deterministic)
    for (let i = 0; i < 13; i++) {
      const cx0 = 100 + i * 12;
      const h = 8 + hash01(i * 7 + 3) * 42;
      const up = hash01(i * 13 + 5) > 0.35;
      c.fillStyle = up ? '#1d8a3e' : '#7d2a30';
      c.fillRect(cx0, 96 - h, 7, h);
      c.fillRect(cx0 + 3, 96 - h - 4, 1, h + 6);
    }
    // THE LIVE CANDLE — you are the pump
    const dip = MINT_FX.dip;
    const liveH = 6 + MINT_FX.chart * 56;
    const liveCol = dip > 0.5 ? '#e5484d' : '#39ff14';
    c.fillStyle = liveCol;
    c.fillRect(262, 96 - liveH, 9, liveH);
    c.fillRect(266, 96 - liveH - 5, 1, liveH + 7);
    if (dip > 0) {
      c.globalAlpha = dip * 0.5;
      c.fillStyle = '#e5484d';
      c.fillRect(94, 28, 196, 76);
      c.globalAlpha = 1;
    }
    // GOD CANDLE: the beam that breaks the ceiling
    const god = MINT_FX.godCandle;
    if (god > 0) {
      const bh = god * 52;
      c.globalAlpha = 0.35;
      c.fillStyle = '#39ff14';
      c.fillRect(261, 96 - liveH - bh, 11, bh);
      c.globalAlpha = 0.9;
      c.fillStyle = '#eaffea';
      c.fillRect(264, 96 - liveH - bh, 5, bh);
      c.globalAlpha = 1;
      for (let i = 0; i < 4; i++) {
        if (hash01((t >> 2) + i * 13) > 0.5) {
          c.fillStyle = '#eaffea';
          c.fillRect(258 + Math.round(hash01(i * 29) * 18), 30 + Math.round(hash01(i * 41) * 60), 2, 2);
        }
      }
    }
    // readouts
    const pct = Math.round(MINT_FX.chart * 69420);
    drawText(c, '$GONNA', 96, 30, 1, '#5ba635');
    drawText(c, '+' + pct + '%', 288, 30, 1, dip > 0.5 ? '#e5484d' : '#39ff14', 'right');

    // ---------- ticker (clipped to its bezel) ----------
    c.save();
    c.beginPath();
    c.rect(92, 113, 200, 12);
    c.clip();
    const scroll = (t * 0.9) % 640;
    drawText(c, MINT_TICKER, 92 - scroll, 116, 1, '#39ff14');
    drawText(c, MINT_TICKER, 92 - scroll + 640, 116, 1, '#39ff14');
    c.restore();

    // ---------- crew: the roster at work ----------
    for (let i = 0; i < MINT_CREW.length; i++) {
      const m = MINT_CREW[i];
      const img = skinPortrait(m.skin);
      const bob = Math.round(Math.sin(t * (0.08 + hype * 0.12) + i * 1.7) * (1 + hype * 2));
      const w = 30;
      const h = 53;
      const dx = m.x - w / 2;
      const dy = m.feet - h + bob;
      if (img) {
        if (m.flip) {
          c.save();
          c.translate(m.x * 2, 0);
          c.scale(-1, 1);
          c.drawImage(img, dx, dy, w, h);
          c.restore();
        } else {
          c.drawImage(img, dx, dy, w, h);
        }
      } else {
        c.fillStyle = SKIN_INFO[m.skin].accent;
        c.fillRect(dx + 8, dy + 14, 14, h - 14);
      }
      if (m.hat) {
        c.fillStyle = '#f5c542';
        c.fillRect(m.x - 7, dy + 7, 14, 4);
        c.fillRect(m.x - 9, dy + 10, 18, 2);
      }
    }

    // ---------- degen at the terminal ----------
    c.fillStyle = '#1d2330';
    c.fillRect(298, 128, 64, 10); // desk
    for (let i = 0; i < 3; i++) {
      c.fillStyle = '#040805';
      c.fillRect(302 + i * 20, 114, 16, 12);
      const up = hash01((t >> 4) + i * 7) > (dip > 0.5 ? 0.75 : 0.35);
      c.fillStyle = up ? '#39ff14' : '#e5484d';
      c.fillRect(304 + i * 20, 116 + Math.round(hash01((t >> 3) + i) * 6), 12, 2);
    }
    const dimg = skinPortrait('leaf');
    const panic = dip > 0.5 ? (t & 2 ? 1 : -1) : 0;
    const djump = god > 0 ? -Math.round(Math.sin(god * Math.PI) * 6) : 0;
    if (dimg) c.drawImage(dimg, 330 + panic, 138 - 53 + djump, 30, 53);
    else {
      c.fillStyle = SKIN_INFO.leaf.accent;
      c.fillRect(338 + panic, 100 + djump, 14, 38);
    }

    // ---------- the international degen crowd ----------
    c.fillStyle = '#10141d';
    c.fillRect(0, 136, VW, 4); // bench strip
    for (let i = 0; i < 16; i++) {
      const cx0 = 10 + i * 24;
      const bounce = Math.abs(Math.round(Math.sin(t * (0.1 + hype * 0.15) + i * 2.3) * (1 + hype * 2.5)));
      const by = 136 - bounce;
      c.fillStyle = MINT_CROWD_TINTS[i % MINT_CROWD_TINTS.length];
      c.fillRect(cx0, by - 9, 7, 9); // body
      c.fillRect(cx0 + 1, by - 14, 5, 5); // head
      c.fillRect(cx0 + 5, by - 12, 3, 2); // snout (no tail. never a tail)
      c.fillStyle = '#0b0d12';
      c.fillRect(cx0 + 2, by - 12, 1, 1); // eye
      if (i % 4 === 1) {
        // sign on a stick
        const word = MINT_SIGNS[(i >> 2) % MINT_SIGNS.length];
        c.fillStyle = '#8a8f9c';
        c.fillRect(cx0 + 3, by - 26, 1, 13);
        c.fillStyle = i % 8 === 1 ? '#e8ecf4' : '#f5c542';
        c.fillRect(cx0 - 13, by - 36, 34, 11);
        drawText(c, word, cx0 + 4, by - 33, 1, '#101218', 'center');
      }
      if (i % 5 === 2) {
        // flags of the degen nations
        const fy = by - 34;
        c.fillStyle = '#8a8f9c';
        c.fillRect(cx0 + 3, fy, 1, 12);
        const kind = (i >> 1) % 4;
        if (kind === 0) {
          c.fillStyle = '#2a9d4f';
          c.fillRect(cx0 + 4, fy, 3, 6);
          c.fillStyle = '#e8ecf4';
          c.fillRect(cx0 + 7, fy, 3, 6);
          c.fillStyle = '#e5484d';
          c.fillRect(cx0 + 10, fy, 3, 6);
        } else if (kind === 1) {
          c.fillStyle = '#e8ecf4';
          c.fillRect(cx0 + 4, fy, 9, 6);
          disc(c, cx0 + 8, fy + 3, 2, '#e5484d');
        } else if (kind === 2) {
          c.fillStyle = '#2a9d4f';
          c.fillRect(cx0 + 4, fy, 9, 6);
          c.fillStyle = '#f5d76e';
          c.fillRect(cx0 + 7, fy + 2, 3, 2);
        } else {
          c.fillStyle = '#e5484d';
          c.fillRect(cx0 + 4, fy, 9, 2);
          c.fillStyle = '#e8ecf4';
          c.fillRect(cx0 + 4, fy + 2, 9, 2);
          c.fillStyle = '#39489c';
          c.fillRect(cx0 + 4, fy, 4, 3);
        }
      }
    }

    // ---------- the cat (unbothered, Capcom-certified) ----------
    const catX = ((t * 0.4) % (VW + 80)) - 40;
    c.fillStyle = '#5a5f6c';
    c.fillRect(catX, 9, 12, 4); // body
    c.fillRect(catX + 10, 6, 5, 5); // head
    c.fillRect(catX + 10, 5, 2, 2); // ear
    c.fillRect(catX + 13, 5, 2, 2); // ear
    c.fillRect(catX - 3, 7 + ((t & 8) >> 3), 3, 2); // tail sways
    c.fillStyle = '#3a3f4c';
    c.fillRect(catX + 2, 13, 2, 2);
    c.fillRect(catX + 8, 13, 2, 2);

    // ---------- BLOCK CONFIRMED (<4s finality flex) ----------
    if (t % 240 < 70 && ((t >> 2) & 1) === 0) {
      drawText(c, 'BLOCK CONFIRMED', VW - 6, 4, 1, '#39ff14', 'right');
    }

    // ---------- steam vents + pistons ----------
    for (let i = 0; i < 3; i++) {
      const vx = [30, 200, 372][i];
      const ph = (t + i * 53) % 150;
      if (ph < 46) {
        for (let k = 0; k < 3; k++) {
          c.globalAlpha = ((46 - ph) / 46) * 0.3;
          disc(c, vx, 128 - ph * 1.3 - k * 9, 3 + k, '#c8cdd7');
        }
        c.globalAlpha = 1;
      }
    }
    for (let i = 0; i < 2; i++) {
      const px0 = [56, 330][i];
      const off = Math.round(Math.sin(t * 0.09 + i * 2) * 5);
      c.fillStyle = '#39404e';
      c.fillRect(px0, 20, 6, 34 + off);
      c.fillStyle = '#8a6518';
      c.fillRect(px0 - 4, 52 + off, 14, 8);
    }

    // ---------- klaxon ----------
    if (MINT_FX.klaxon && (t & 16) === 0) {
      disc(c, 14, 10, 5, '#e5484d');
      disc(c, VW - 14, 10, 5, '#e5484d');
      c.globalAlpha = 0.25;
      disc(c, 14, 10, 9, '#e5484d');
      disc(c, VW - 14, 10, 9, '#e5484d');
      c.globalAlpha = 1;
    }
    c.restore();
  };
}

function sMintFront(): StageAnim {
  return (c, _camX, t) => {
    // hanging chains, foreground silhouettes
    c.fillStyle = 'rgba(5,7,11,0.85)';
    for (const cx0 of [10, VW - 18]) {
      for (let k = 0; k < 5; k++) c.fillRect(cx0 + (k & 1), k * 9, 4, 7);
    }
    // klaxon red wash
    if (MINT_FX.klaxon && (t & 16) === 0) {
      c.fillStyle = 'rgba(229,72,77,0.06)';
      c.fillRect(0, 0, VW, VH);
    }
    // foreground steam wisps
    const ph = (t * 0.7) % 200;
    if (ph < 60) {
      c.globalAlpha = 0.08 * (1 - ph / 60);
      disc(c, 330, 210 - ph, 14, '#c8cdd7');
      c.globalAlpha = 1;
    }
  };
}

export function buildMintStage(): StageDef {
  const len = VW; // single-screen arena: the camera never moves
  return {
    name: 'BONUS STAGE',
    sub: 'THE MINTING',
    track: 'stage3', // the Wall Street drive rolls straight into the forge
    len,
    arenaX: len,
    boss: false,
    bossKind: null,
    bossTrack: 'boss',
    mint: true,
    waves: [],
    obstacles: [],
    far: sMintFar(len * 0.3 + VW),
    mid: sMintMid(len * 0.6 + VW),
    ground: sMintGround(len),
    back: sMintBack(),
    front: sMintFront(),
  };
}
