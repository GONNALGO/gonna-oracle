// 3 stages: procedural 3-layer parallax backgrounds + wave/obstacle layout.
import { drawText } from './font';
import { VH, VW, rand } from './types';
import type { EnemyKind } from './enemies';
import type { ItemKind, ObstacleKind } from './items';

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
  track: 'stage1' | 'stage2' | 'stage3';
  len: number;
  waves: WaveDef[];
  obstacles: ObstacleDef[];
  boss: boolean;
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
      waves: [
        { triggerX: 120, spawns: ['gecko', 'drone', 'snek'] },
        { triggerX: 500, spawns: ['whale', 'gecko'] },
        { triggerX: 920, spawns: ['snek', 'snek', 'drone', 'gecko'] },
        { triggerX: 1360, spawns: ['whale', 'gecko', 'drone'] },
      ],
      obstacles: [
        { kind: 'crate', x: 300, y: 172, contains: 'chicken' },
        { kind: 'barrel', x: 640, y: 162, contains: 'random' },
        { kind: 'barrel', x: 1050, y: 192, contains: 'chest' },
        { kind: 'crate', x: 1420, y: 168, contains: 'coinA' },
        { kind: 'can', x: 1750, y: 186, contains: 'random' },
      ],
      far: s2Far(len * 0.3 + VW),
      mid: s2Mid(len * 0.6 + VW),
      ground: s2Ground(len),
    };
  }
  const len = 1680;
  return {
    name: 'STAGE 3',
    sub: 'WALL STREET BIZANTINA',
    track: 'stage3',
    len,
    arenaX: len - VW,
    boss: true,
    waves: [
      { triggerX: 120, spawns: ['gecko', 'gecko', 'snek'] },
      { triggerX: 480, spawns: ['whale', 'drone', 'drone'] },
      { triggerX: 840, spawns: ['whale', 'snek', 'gecko'] },
    ],
    obstacles: [
      { kind: 'crate', x: 280, y: 170, contains: 'chicken' },
      { kind: 'barrel', x: 620, y: 188, contains: 'random' },
      { kind: 'crate', x: 900, y: 164, contains: 'liz' },
      { kind: 'can', x: 1150, y: 194, contains: 'coinG' },
    ],
    far: s3Far(len * 0.3 + VW),
    mid: s3Mid(len * 0.6 + VW),
    ground: s3Ground(len),
  };
}
