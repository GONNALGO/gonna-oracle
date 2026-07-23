// 6 stages: procedural 3-layer parallax backgrounds + wave/obstacle layout.
import { drawText } from './font';
import { VH, VW, rand } from './types';
import type { EnemyKind } from './enemies';
import type { ItemKind, ObstacleKind } from './items';
import type { BossKind } from './boss';

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
  far: HTMLCanvasElement;
  mid: HTMLCanvasElement;
  ground: HTMLCanvasElement;
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

// ---------------- STAGE 1: METRO ALGORAND (night city) ----------------
function s1Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 0, w, 100, '#0a1a22');
  R(x, 0, 100, w, 60, '#0d2530');
  R(x, 0, 160, w, 64, '#0a1c26');
  // stars
  for (let i = 0; i < 90; i++) R(x, rand(0, w), rand(0, 90), 1, 1, i % 3 ? '#9fd8e8' : '#5a8a9a');
  // moon
  disc(x, w * 0.7, 34, 16, '#e8e4c8');
  disc(x, w * 0.7 - 5, 30, 4, '#c8c4a8');
  disc(x, w * 0.7 + 6, 40, 3, '#c8c4a8');
  // skyline
  let bx = 0;
  while (bx < w) {
    const bw = rand(24, 60);
    const bh = rand(40, 100);
    R(x, bx, 160 - bh, bw, bh + 64, '#081118');
    for (let wy = 160 - bh + 4; wy < 150; wy += 8) {
      for (let wx = bx + 3; wx < bx + bw - 3; wx += 7) {
        if (Math.random() < 0.3) R(x, wx, wy, 2, 3, Math.random() < 0.5 ? '#f5c542' : '#7fd858');
      }
    }
    bx += bw + rand(4, 14);
  }
  return c;
}

function s1Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  // building row
  let bx = 0;
  let sign = 0;
  while (bx < w) {
    const bw = rand(100, 170);
    const bh = rand(60, 110);
    R(x, bx, 150 - bh, bw, bh, '#0f2430');
    R(x, bx, 150 - bh, bw, 3, '#1a3a4a');
    for (let wy = 150 - bh + 8; wy < 144; wy += 12) {
      for (let wx = bx + 6; wx < bx + bw - 8; wx += 10) {
        R(x, wx, wy, 5, 7, Math.random() < 0.35 ? '#2a5a4a' : '#12202c');
      }
    }
    // neon signs on some buildings
    if (sign % 4 === 0 && bw > 100) {
      R(x, bx + 10, 150 - bh + 14, 62, 16, '#101018');
      drawText(x, '$ALGO', bx + 14, 150 - bh + 18, 2, '#7fd858');
      R(x, bx + 10, 150 - bh + 28, 62, 2, '#3fae4a');
    } else if (sign % 4 === 2 && bw > 120) {
      R(x, bx + 8, 150 - bh + 12, 78, 12, '#101018');
      drawText(x, 'GONNAVERSE', bx + 11, 150 - bh + 15, 1, '#f5c542');
    } else if (sign % 4 === 3 && bw > 110) {
      R(x, bx + 12, 150 - bh + 10, 44, 10, '#1e6b2a');
      drawText(x, 'SILVIO ST', bx + 14, 150 - bh + 12, 1, '#e8f4e8');
    }
    sign++;
    bx += bw + 6;
  }
  // byzantine arch band along bottom
  R(x, 0, 130, w, 20, '#12232e');
  for (let ax = 0; ax < w; ax += 26) {
    x.fillStyle = '#b8860b';
    x.beginPath();
    x.arc(ax + 13, 148, 10, Math.PI, 0);
    x.fill();
    x.fillStyle = '#12232e';
    x.beginPath();
    x.arc(ax + 13, 148, 7, Math.PI, 0);
    x.fill();
  }
  // graffiti lizards
  for (let gx = 60; gx < w; gx += 260) {
    R(x, gx, 118, 18, 10, '#3fae4a');
    R(x, gx + 14, 114, 8, 8, '#3fae4a');
    R(x, gx + 19, 116, 2, 2, '#101018');
    R(x, gx - 4, 122, 5, 4, '#1e6b2a');
  }
  return c;
}

function s1Ground(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84); // drawn at y=140
  R(x, 0, 0, len, 10, '#2a2f3a'); // sidewalk
  R(x, 0, 9, len, 2, '#3a4a5a'); // curb
  R(x, 0, 11, len, 73, '#191c24'); // asphalt
  R(x, 0, 40, len, 24, '#1d212b'); // lane band lighter
  for (let dx = 20; dx < len; dx += 60) R(x, dx, 30, 18, 2, '#b8860b'); // lane dashes
  for (let i = 0; i < len / 22; i++) R(x, rand(0, len), rand(12, 80), 2, 1, '#242a36'); // specks
  for (let mx = 120; mx < len; mx += 340) {
    disc(x, mx, 62, 7, '#12151c');
    disc(x, mx, 62, 5, '#1d212b');
  }
  for (let px = 200; px < len; px += 420) R(x, px, 46, 30, 8, '#14302a'); // neon puddle glow
  return c;
}

// ---------------- STAGE 2: GONNAVERSE DOCKS (sunset) ----------------
function s2Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 0, w, 50, '#2a1a4a');
  R(x, 0, 50, w, 40, '#6a2a55');
  R(x, 0, 90, w, 30, '#c2543a');
  R(x, 0, 120, w, 20, '#e2713a');
  disc(x, w * 0.55, 118, 20, '#f5c542'); // sun
  // clouds
  for (let i = 0; i < 14; i++) {
    const cx = rand(0, w);
    const cy = rand(10, 80);
    R(x, cx, cy, rand(20, 50), 4, '#4a2a5a');
    R(x, cx + 6, cy - 3, rand(14, 30), 3, '#5a3a6a');
  }
  // sea
  R(x, 0, 138, w, 86, '#1a2a4a');
  for (let i = 0; i < w / 8; i++) {
    R(x, rand(0, w), rand(142, 200), rand(6, 18), 1, Math.random() < 0.4 ? '#e2713a' : '#3a5a8a');
  }
  return c;
}

function s2Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  // cranes
  for (let cx = 60; cx < w; cx += 300) {
    R(x, cx, 40, 8, 100, '#241a3a');
    R(x, cx - 40, 40, 110, 6, '#241a3a');
    R(x, cx + 60, 46, 2, 30, '#241a3a');
    R(x, cx + 56, 76, 10, 8, '#241a3a');
  }
  // container stacks
  const cols = ['#7a3a3a', '#3a6a4a', '#3a4a7a', '#8a6a2a'];
  let bx = 0;
  while (bx < w) {
    const bw = rand(60, 100);
    const stack = 1 + Math.floor(rand(0, 3));
    for (let s = 0; s < stack; s++) {
      const col = cols[Math.floor(rand(0, cols.length))];
      R(x, bx, 138 - s * 18, bw, 18, col);
      R(x, bx, 138 - s * 18, bw, 2, 'rgba(0,0,0,0.3)');
      for (let rx = bx + 4; rx < bx + bw - 4; rx += 8) R(x, rx, 140 - s * 18, 2, 14, 'rgba(0,0,0,0.25)');
      if (s === stack - 1 && bw > 70) drawText(x, '1T SUPPLY', bx + 8, 144 - s * 18, 1, '#e8e4d8');
    }
    bx += bw + rand(8, 30);
  }
  return c;
}

function s2Ground(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84);
  R(x, 0, 0, len, 84, '#5a4632'); // planks base
  for (let py = 4; py < 84; py += 8) {
    R(x, 0, py, len, 1, '#3e2f20');
    for (let nx = ((py * 37) % 60); nx < len; nx += 60) R(x, nx, py + 3, 1, 1, '#2e2118');
  }
  R(x, 0, 0, len, 3, '#6e5840');
  for (let bx = 80; bx < len; bx += 300) {
    R(x, bx, 2, 8, 10, '#2e2e3c'); // bollard
    R(x, bx - 1, 2, 10, 3, '#4a4a5c');
  }
  for (let i = 0; i < len / 30; i++) R(x, rand(0, len), rand(10, 80), 3, 1, '#4a3a28');
  return c;
}

// ---------------- STAGE 3: WALL STREET BIZANTINA ----------------
function s3Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 0, w, VH, '#0a0e1e');
  // chart grid
  x.fillStyle = '#12202a';
  for (let gy = 20; gy < 140; gy += 20) x.fillRect(0, gy, w, 1);
  for (let gx = 0; gx < w; gx += 40) x.fillRect(gx, 0, 1, 140);
  // giant golden candle chart ascending
  let cy = 120;
  for (let cx = 10; cx < w; cx += 18) {
    const up = Math.random() < 0.62;
    const body = rand(8, 26);
    if (up) cy -= rand(2, 9); else cy += rand(1, 6);
    cy = Math.max(24, Math.min(132, cy));
    const col = up ? '#3fae4a' : '#e23b3b';
    R(x, cx + 3, cy - 6, 2, body + 12, col); // wick
    R(x, cx, cy, 8, body, col);
  }
  // ticker line
  x.strokeStyle = '#f5c542';
  x.lineWidth = 1;
  x.beginPath();
  let ty = 100;
  x.moveTo(0, ty);
  for (let cx = 0; cx < w; cx += 24) {
    ty += rand(-8, 6);
    ty = Math.max(30, Math.min(120, ty));
    x.lineTo(cx, ty);
  }
  x.stroke();
  R(x, 0, 140, w, 84, '#0d1226');
  return c;
}

function s3Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 30, w, 112, '#241d12'); // wall behind
  // mosaic band: gold with byzantine diamonds
  R(x, 0, 60, w, 22, '#b8860b');
  for (let mx = 0; mx < w; mx += 12) {
    R(x, mx + 3, 66, 6, 10, '#1e6b2a');
    R(x, mx + 5, 68, 2, 6, '#f5c542');
  }
  // marble columns
  for (let cx = 30; cx < w; cx += 150) {
    R(x, cx - 4, 132, 34, 8, '#a8a498'); // base
    R(x, cx, 40, 26, 94, '#d8d4c8'); // shaft
    R(x, cx, 40, 6, 94, '#b8b4a8'); // shade
    R(x, cx + 20, 40, 4, 94, '#e8e4d8'); // highlight
    R(x, cx - 4, 34, 34, 8, '#c8c4b8'); // capital
    R(x, cx - 2, 30, 30, 4, '#b8860b'); // gold trim
  }
  // banners
  for (let bx = 100; bx < w; bx += 300) {
    R(x, bx, 84, 26, 40, '#7a1a2a');
    R(x, bx, 84, 26, 3, '#f5c542');
    R(x, bx, 121, 26, 3, '#f5c542');
    drawText(x, '$G', bx + 6, 98, 2, '#f5c542');
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
  return c;
}

// ---------------- STAGE 4: SILVIO'S DOJO (byzantine night dojo) ----------------
function s4Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 0, w, VH, '#0a0a18');
  R(x, 0, 100, w, 124, '#101024');
  // stars
  for (let i = 0; i < 70; i++) R(x, rand(0, w), rand(0, 90), 1, 1, i % 3 ? '#c8b8e8' : '#6a5a9a');
  // full moon
  disc(x, w * 0.32, 36, 15, '#e8e4f8');
  disc(x, w * 0.32 - 4, 32, 4, '#c8c4e0');
  // distant temple roofs (pagoda silhouettes)
  for (let tx = 40; tx < w; tx += 340) {
    R(x, tx, 96, 90, 44, '#141428');
    R(x, tx - 12, 90, 114, 8, '#1c1c38');
    R(x, tx + 20, 66, 50, 26, '#141428');
    R(x, tx + 8, 60, 74, 8, '#1c1c38');
    R(x, tx + 40, 48, 10, 14, '#1c1c38');
    // lit windows
    for (let wx = tx + 8; wx < tx + 82; wx += 16) {
      if (Math.random() < 0.5) R(x, wx, 108, 6, 8, '#f5c542');
    }
  }
  return c;
}

function s4Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 24, w, 118, '#1a1020'); // dojo back wall
  // mosaic band: purple/gold byzantine diamonds
  R(x, 0, 46, w, 18, '#3a2a5a');
  for (let mx = 0; mx < w; mx += 12) {
    R(x, mx + 3, 50, 6, 10, '#b8860b');
    R(x, mx + 5, 52, 2, 6, '#f5c542');
  }
  // shoji screens
  for (let sx = 90; sx < w; sx += 300) {
    R(x, sx, 74, 60, 56, '#d8d4c8');
    R(x, sx, 74, 60, 3, '#6b4a2a');
    R(x, sx, 127, 60, 3, '#6b4a2a');
    for (let gx = sx + 14; gx < sx + 60; gx += 15) R(x, gx, 74, 2, 56, '#6b4a2a');
    R(x, sx, 98, 60, 2, '#6b4a2a');
    R(x, sx + 6, 82, 10, 10, '#fff6d8'); // lantern glow through paper
  }
  // marble columns with gold capitals
  for (let cx = 30; cx < w; cx += 150) {
    R(x, cx - 4, 132, 34, 8, '#8a867a');
    R(x, cx, 36, 26, 98, '#c8c4d8');
    R(x, cx, 36, 6, 98, '#a8a4b8');
    R(x, cx + 20, 36, 4, 98, '#e8e4f0');
    R(x, cx - 4, 30, 34, 8, '#b8860b');
    R(x, cx - 2, 26, 30, 4, '#f5c542');
  }
  // golden lanterns hanging
  for (let lx = 105; lx < w; lx += 150) {
    R(x, lx + 6, 24, 2, 10, '#4a3a20'); // cord
    R(x, lx, 34, 14, 18, '#f5c542');
    R(x, lx, 34, 14, 3, '#b8860b');
    R(x, lx, 49, 14, 3, '#b8860b');
    R(x, lx + 5, 38, 4, 10, '#fff6d8'); // glow core
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
  // gold inlay lane markers
  for (let dx = 10; dx < len; dx += 84) R(x, dx, 41, 6, 2, '#b8860b');
  for (let i = 0; i < len / 40; i++) R(x, rand(0, len), rand(4, 80), 2, 1, 'rgba(0,0,0,0.18)');
  return c;
}

// ---------------- STAGE 5: NEON CASINO — THE HOUSE ----------------
function s5Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  // synthwave gradient wall
  R(x, 0, 0, w, 46, '#160a2a');
  R(x, 0, 46, w, 46, '#2a1040');
  R(x, 0, 92, w, 48, '#451a55');
  // neon grid
  x.fillStyle = '#5a2a7a';
  for (let gy = 100; gy < 140; gy += 10) x.fillRect(0, gy, w, 1);
  for (let gx = 0; gx < w; gx += 32) x.fillRect(gx, 92, 1, 48);
  // neon sun
  disc(x, w * 0.62, 76, 22, '#ff5a8a');
  R(x, 0, 140, w, 84, '#1c0e30');
  // hanging light strings
  for (let lx = 0; lx < w; lx += 14) {
    const ly = 8 + Math.abs(((lx * 7) % 20) - 10);
    R(x, lx, ly, 2, 2, lx % 42 === 0 ? '#ff5a8a' : lx % 28 === 0 ? '#7fd858' : '#f5c542');
  }
  return c;
}

function s5Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 60, w, 82, '#241236'); // wall behind machines
  // THE HOUSE ALWAYS WINS sign
  R(x, w * 0.5 - 130, 18, 260, 22, '#101018');
  R(x, w * 0.5 - 130, 18, 260, 2, '#ff5a8a');
  R(x, w * 0.5 - 130, 38, 260, 2, '#ff5a8a');
  drawText(x, 'THE HOUSE ALWAYS WINS', w * 0.5 - 122, 26, 1, '#ff5a8a');
  // slot machine row
  for (let sx = 10; sx < w; sx += 74) {
    R(x, sx, 84, 56, 58, '#7a1a2a');
    R(x, sx, 84, 56, 4, '#93222f');
    R(x, sx, 84, 4, 58, '#b8860b');
    R(x, sx + 52, 84, 4, 58, '#b8860b');
    R(x, sx + 8, 92, 40, 16, '#101018'); // reel window
    const sy = (sx / 74) % 3;
    drawText(x, sy === 0 ? '7' : 'G', sx + 13, 96, 2, '#f5c542');
    drawText(x, sy === 1 ? '7' : 'G', sx + 25, 96, 2, sy === 2 ? '#ff6b6b' : '#f5c542');
    drawText(x, '7', sx + 37, 96, 2, '#f5c542');
    R(x, sx + 10, 114, 36, 8, '#b8860b'); // tray
    R(x, sx + 12, 115, 32, 5, '#f5c542');
    R(x, sx + 60, 90, 3, 16, '#c8ccd4'); // lever
    R(x, sx + 58, 86, 7, 6, '#e23b3b');
    // neon topper
    R(x, sx + 4, 76, 48, 6, (sx / 74) % 2 ? '#ff5a8a' : '#3fd8d8');
  }
  // $GONNA chip garlands
  for (let gx = 30; gx < w; gx += 200) {
    R(x, gx, 66, 10, 10, '#f5c542');
    R(x, gx + 2, 68, 6, 6, '#b8860b');
    drawText(x, 'G', gx + 2, 68, 1, '#f5c542');
  }
  return c;
}

function s5Ground(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84);
  // red carpet
  R(x, 0, 0, len, 84, '#6e1424');
  R(x, 0, 0, len, 3, '#93222f');
  R(x, 0, 81, len, 3, '#4a0e1a');
  // gold trim + diamond pattern
  R(x, 0, 8, len, 2, '#b8860b');
  R(x, 0, 74, len, 2, '#b8860b');
  for (let dx = 8; dx < len; dx += 32) {
    R(x, dx, 38, 8, 8, '#93222f');
    R(x, dx + 2, 40, 4, 4, '#b8860b');
  }
  // scattered $GONNA chips on the carpet
  for (let i = 0; i < len / 110; i++) {
    const cx = rand(0, len);
    const cy = rand(14, 70);
    R(x, cx, cy, 6, 4, '#f5c542');
    R(x, cx + 1, cy + 1, 4, 2, '#b8860b');
  }
  return c;
}

// ---------------- STAGE 6: MOON LAUNCHPAD ----------------
function s6Far(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  R(x, 0, 0, w, VH, '#05060f');
  // starfield
  for (let i = 0; i < 130; i++) R(x, rand(0, w), rand(0, 130), 1, 1, i % 4 ? '#c8d4f8' : '#7a8ac8');
  // the Moon (big) + Earth (small, blue)
  disc(x, w * 0.24, 42, 24, '#d8d4c8');
  disc(x, w * 0.24 - 7, 36, 6, '#b8b4a8');
  disc(x, w * 0.24 + 8, 48, 5, '#b8b4a8');
  disc(x, w * 0.24 - 2, 52, 3, '#a8a498');
  disc(x, w * 0.68, 30, 11, '#3b6fd4');
  disc(x, w * 0.68 - 3, 27, 4, '#3fae4a');
  disc(x, w * 0.68 + 4, 33, 3, '#7fd858');
  // horizon glow
  R(x, 0, 128, w, 12, '#101a30');
  R(x, 0, 140, w, 84, '#0a0e1c');
  return c;
}

function s6Mid(w: number): HTMLCanvasElement {
  const [c, x] = mk(w, VH);
  // GONNA rocket on the pad (repeats along the stage, launch gantry)
  for (let rx = 160; rx < w; rx += 620) {
    // gantry tower
    R(x, rx - 60, 20, 14, 122, '#2a2f3a');
    for (let gy = 26; gy < 140; gy += 14) R(x, rx - 58, gy, 10, 2, '#4a4f5c');
    R(x, rx - 46, 40, 26, 4, '#2a2f3a');
    R(x, rx - 46, 84, 26, 4, '#2a2f3a');
    // rocket body
    R(x, rx, 44, 34, 98, '#e8e4d8');
    R(x, rx, 44, 34, 10, '#c8ccd4');
    // nose cone
    R(x, rx + 4, 26, 26, 18, '#3fae4a');
    R(x, rx + 10, 16, 14, 10, '#3fae4a');
    // window
    R(x, rx + 11, 60, 12, 12, '#101a30');
    R(x, rx + 13, 62, 8, 8, '#7ecbff');
    // green $GONNA livery
    R(x, rx, 84, 34, 6, '#3fae4a');
    drawText(x, 'GONNA', rx + 3, 96, 1, '#1e6b2a');
    // fins
    R(x, rx - 10, 118, 12, 24, '#1e6b2a');
    R(x, rx + 32, 118, 12, 24, '#1e6b2a');
    R(x, rx + 8, 140, 18, 4, '#8a8f9c'); // engine
  }
  // floodlight poles + countdown sign
  for (let px = 60; px < w; px += 310) {
    R(x, px, 60, 4, 82, '#2a2f3a');
    R(x, px - 6, 54, 16, 8, '#4a4f5c');
    R(x, px - 4, 56, 4, 4, '#fff6d8');
    R(x, px + 4, 56, 4, 4, '#fff6d8');
  }
  R(x, w * 0.5 - 44, 30, 88, 16, '#101018');
  drawText(x, 'T-MINUS SOON', w * 0.5 - 38, 35, 1, '#ff5a5a');
  return c;
}

function s6Ground(len: number): HTMLCanvasElement {
  const [c, x] = mk(len, 84);
  R(x, 0, 0, len, 84, '#2e323e'); // metal deck
  for (let gx = 0; gx < len; gx += 42) {
    R(x, gx, 0, 2, 84, '#23262f');
    for (let ry = 8; ry < 84; ry += 20) R(x, gx + 6, ry, 2, 2, '#3e4350'); // rivets
  }
  R(x, 0, 0, len, 3, '#4a4f5c');
  // hazard stripe band
  for (let hx = 0; hx < len; hx += 16) {
    R(x, hx, 76, 8, 6, '#b8860b');
    R(x, hx + 8, 76, 8, 6, '#101018');
  }
  // painted markings
  for (let mx = 140; mx < len; mx += 420) drawText(x, 'TO THE MOON', mx, 30, 1, '#3e4350');
  return c;
}

// ---------------- stage table ----------------
export function buildStage(idx: number): StageDef {
  if (idx === 0) {
    const len = 1920;
    return {
      name: 'STAGE 1',
      sub: 'METRO ALGORAND',
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
    };
  }
  if (idx === 1) {
    const len = 1920;
    return {
      name: 'STAGE 2',
      sub: 'GONNAVERSE DOCKS',
      track: 'stage2',
      len,
      arenaX: len,
      boss: false,
      bossKind: null,
      bossTrack: 'boss',
      waves: [
        { triggerX: 120, spawns: ['gecko', 'drone', 'snek'] },
        { triggerX: 500, spawns: ['whale', 'gecko'] },
        { triggerX: 920, spawns: ['snek', 'snek', 'drone', 'gecko'] },
        { triggerX: 1360, spawns: ['whale', 'gecko', 'drone'] },
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
    };
  }
  if (idx === 2) {
    const len = 1680;
    return {
      name: 'STAGE 3',
      sub: 'WALL STREET BIZANTINA',
      track: 'stage3',
      len,
      arenaX: len - VW,
      boss: true,
      bossKind: 'whale',
      bossTrack: 'boss',
      waves: [
        { triggerX: 120, spawns: ['gecko', 'gecko', 'snek'] },
        { triggerX: 480, spawns: ['whale', 'drone', 'drone'] },
        { triggerX: 840, spawns: ['whale', 'snek', 'gecko'] },
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
    };
  }
  if (idx === 3) {
    const len = 1680;
    return {
      name: 'STAGE 4',
      sub: "SILVIO'S DOJO",
      track: 'stage4',
      len,
      arenaX: len - VW,
      boss: true,
      bossKind: 'darkgonna',
      bossTrack: 'boss',
      waves: [
        { triggerX: 120, spawns: ['gecko', 'gecko', 'ninja'] },
        { triggerX: 480, spawns: ['ninja', 'ninja', 'gecko'] },
        { triggerX: 840, spawns: ['ninja', 'gecko', 'snek', 'ninja'] },
        { triggerX: 1120, spawns: ['ninja', 'ninja', 'ninja'] },
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
    };
  }
  if (idx === 4) {
    const len = 1920;
    return {
      name: 'STAGE 5',
      sub: 'NEON CASINO - THE HOUSE',
      track: 'stage5',
      len,
      arenaX: len - VW,
      boss: true,
      bossKind: 'golem',
      bossTrack: 'boss',
      waves: [
        { triggerX: 120, spawns: ['coinsnek', 'snek', 'gecko'] },
        { triggerX: 500, spawns: ['bouncer', 'coinsnek'] },
        { triggerX: 920, spawns: ['coinsnek', 'coinsnek', 'snek', 'ninja'] },
        { triggerX: 1360, spawns: ['bouncer', 'bouncer', 'coinsnek'] },
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
    };
  }
  const len = 1680;
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
      { triggerX: 120, spawns: ['ninja', 'coinsnek', 'whale'] },
      { triggerX: 440, spawns: ['bouncer', 'ninja', 'drone'] },
      { triggerX: 800, spawns: ['whale', 'coinsnek', 'ninja', 'snek'] },
      { triggerX: 1060, spawns: ['bouncer', 'ninja', 'coinsnek'] },
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
  };
}
