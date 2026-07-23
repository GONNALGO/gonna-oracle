// Player frames (loaded PNGs) + ALL other art: procedural pixel art drawn at boot.
import { drawText } from './font';

// cohesive palette
export const PAL = {
  green: '#3fae4a',
  greenL: '#7fd858',
  greenD: '#1e6b2a',
  gold: '#f5c542',
  goldD: '#b8860b',
  ink: '#101018',
  purple: '#7b4bc9',
  purpleD: '#5a3699',
  blue: '#3b6fd4',
  blueD: '#274b8f',
  navy: '#1c2f5e',
  silver: '#c8ccd4',
  silverD: '#8a8f9c',
  white: '#f2f2f2',
  red: '#e23b3b',
};

type Ctx = CanvasRenderingContext2D;

function mk(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  return [c, x];
}

function R(x: Ctx, px: number, py: number, w: number, h: number, c: string): void {
  x.fillStyle = c;
  x.fillRect(px | 0, py | 0, w | 0, h | 0);
}

// ---------------- player frames ----------------
export async function loadFrames(): Promise<Map<string, HTMLImageElement>> {
  const manifest = (await (await fetch('frames/manifest.json')).json()) as { file: string; row: number; col: number }[];
  const map = new Map<string, HTMLImageElement>();
  await Promise.all(
    manifest.map(
      (m) =>
        new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            map.set(`${m.row}_${m.col}`, img);
            resolve();
          };
          img.onerror = () => reject(new Error('frame load failed: ' + m.file));
          img.src = 'frames/' + m.file;
        }),
    ),
  );
  return map;
}

// ---------------- enemies ----------------
// All characters face RIGHT; flip at draw time.

function paintGecko(legFrame: number, punch: boolean): HTMLCanvasElement {
  const [c, x] = mk(34, 54);
  // tail
  R(x, 2, 30, 6, 4, PAL.green);
  R(x, 0, 32, 4, 3, PAL.greenD);
  // far arm
  R(x, 8, 20, 4, 9, PAL.greenD);
  // legs
  const a = legFrame ? 2 : 0;
  R(x, 10, 38, 5, 11 - a, '#23232e');
  R(x, 9, 47 - a, 7, 4, PAL.ink);
  R(x, 18, 38, 5, 11 - (legFrame ? 0 : 2), '#2e2e3c');
  R(x, 17, 47 - (legFrame ? 0 : 2), 7, 4, '#181822');
  // hood behind head
  R(x, 8, 8, 7, 11, PAL.purpleD);
  // torso hoodie
  R(x, 8, 17, 16, 21, PAL.purple);
  R(x, 8, 17, 16, 3, PAL.purpleD);
  R(x, 11, 30, 10, 6, PAL.purpleD); // pocket
  // head
  R(x, 12, 4, 14, 12, PAL.green);
  R(x, 20, 8, 9, 6, PAL.green); // snout
  R(x, 24, 13, 5, 2, PAL.greenD); // jaw
  R(x, 13, 2, 3, 3, PAL.greenL);
  R(x, 17, 1, 3, 4, PAL.greenL);
  R(x, 21, 2, 3, 3, PAL.greenL); // crest
  R(x, 21, 6, 4, 4, PAL.white);
  R(x, 23, 7, 2, 2, PAL.ink); // eye
  R(x, 12, 16, 10, 2, PAL.gold); // chain
  // near arm
  if (punch) {
    R(x, 22, 20, 8, 5, PAL.green);
    R(x, 30, 19, 4, 6, PAL.greenL); // fist
  } else {
    R(x, 21, 20, 4, 10, PAL.green);
    R(x, 21, 29, 4, 4, PAL.greenL);
  }
  return c;
}

function paintDrone(rotor: number, dive: boolean): HTMLCanvasElement {
  const [c, x] = mk(30, 30);
  // rotor
  if (dive) {
    R(x, 13, 0, 4, 3, PAL.silverD);
  } else if (rotor) {
    R(x, 4, 1, 22, 2, PAL.silverD);
  } else {
    R(x, 8, 0, 14, 2, PAL.silver);
  }
  R(x, 13, 2, 4, 3, PAL.ink);
  // dome body
  R(x, 5, 6, 20, 5, PAL.silver);
  R(x, 3, 11, 24, 8, PAL.silver);
  R(x, 5, 19, 20, 4, PAL.silverD);
  R(x, 3, 11, 24, 2, PAL.white); // highlight
  // eye
  R(x, 22, 12, 4, 4, dive ? '#ff7b7b' : PAL.red);
  // $A logo
  drawText(x, 'A', 9, 12, 1, PAL.greenD);
  // thruster
  R(x, 12, 23, 6, 2, PAL.ink);
  if (dive) {
    R(x, 12, 25, 6, 3, PAL.gold);
    R(x, 13, 28, 4, 2, '#ff8a3c');
  } else {
    R(x, 13, 25, 4, 2, '#7ecbff');
  }
  return c;
}

function paintWhale(legFrame: number, charge: boolean, block: boolean): HTMLCanvasElement {
  const [c, x] = mk(50, 66);
  const lean = charge ? 5 : 0;
  // shoes + pants
  const a = legFrame ? 2 : 0;
  R(x, 14, 56, 8, 8 - a, PAL.navy);
  R(x, 12, 62 - a, 11, 4, PAL.ink);
  R(x, 28, 56, 8, 8 - (legFrame ? 0 : 2), '#16264c');
  R(x, 26, 62 - (legFrame ? 0 : 2), 11, 4, '#181822');
  // jacket (big torso)
  R(x, 8 + lean, 24, 34, 34, PAL.blueD);
  R(x, 8 + lean, 24, 34, 4, '#1e3c74');
  // shirt
  R(x, 22 + lean, 26, 8, 26, PAL.white);
  R(x, 25 + lean, 28, 3, 14, PAL.red); // tie
  // buttons
  R(x, 14 + lean, 40, 2, 2, PAL.gold);
  R(x, 14 + lean, 48, 2, 2, PAL.gold);
  // far fin arm
  R(x, 6 + lean, 30, 5, 16, PAL.blueD);
  // head
  R(x, 12 + lean, 2, 26, 22, PAL.blue);
  R(x, 34 + lean, 10, 10, 10, PAL.blue); // snout
  R(x, 14 + lean, 18, 30, 7, PAL.white); // jaw
  R(x, 14 + lean, 17, 30, 2, PAL.ink); // mouth line
  R(x, 30 + lean, 8, 5, 5, PAL.white);
  R(x, 32 + lean, 10, 2, 2, PAL.ink); // eye
  R(x, 29 + lean, 6, 7, 2, PAL.ink); // angry brow
  R(x, 20 + lean, 0, 5, 2, PAL.blueD); // blowhole
  // near fin arm / block arms
  if (block) {
    R(x, 34 + lean, 26, 6, 20, PAL.blue);
    R(x, 30 + lean, 26, 6, 20, PAL.blue);
  } else if (charge) {
    R(x, 2, 34, 8, 6, PAL.blue);
  } else {
    R(x, 38 + lean, 30, 6, 16, PAL.blue);
    R(x, 38 + lean, 44, 6, 5, PAL.blueD);
  }
  return c;
}

function paintSnek(frame: number, dash: boolean): HTMLCanvasElement {
  const [c, x] = mk(40, 26);
  if (dash) {
    // stretched dash body
    R(x, 0, 16, 26, 5, PAL.green);
    R(x, 0, 19, 26, 2, PAL.greenD);
    R(x, 24, 12, 10, 8, PAL.green); // head forward
    R(x, 28, 10, 6, 3, PAL.greenD); // hood
    R(x, 31, 14, 3, 3, PAL.white);
    R(x, 32, 15, 2, 2, PAL.ink);
    // knife
    R(x, 34, 14, 6, 2, PAL.silver);
    R(x, 33, 13, 2, 4, '#6b4a2a');
  } else {
    // coiled body S-curve
    const s = frame ? 1 : 0;
    R(x, 2, 18, 14, 4, PAL.green);
    R(x, 4 + s, 14, 14, 4, PAL.green);
    R(x, 6, 21, 16, 3, PAL.greenD);
    R(x, 10 + s, 11, 12, 4, PAL.greenD);
    // raised head w/ hood
    R(x, 22 + s, 4, 10, 12, PAL.green);
    R(x, 20 + s, 4, 4, 10, PAL.greenD); // hood L
    R(x, 30 + s, 4, 4, 10, PAL.greenD); // hood R
    R(x, 28 + s, 7, 3, 3, PAL.white);
    R(x, 29 + s, 8, 2, 2, PAL.ink);
    R(x, 26 + s, 15, 6, 2, PAL.red); // tongue
    // knife held high
    R(x, 33 + s, 2, 5, 2, PAL.silver);
    R(x, 32 + s, 1, 2, 4, '#6b4a2a');
  }
  return c;
}

// ---------------- boss: THE WHALE OF WALL STREET ----------------
function paintBoss(pose: 'idle' | 'swing' | 'flop'): HTMLCanvasElement {
  const [c, x] = mk(110, 122);
  const wide = pose === 'flop' ? 6 : 0;
  // legs + shoes
  R(x, 34, 100, 14, 18, PAL.navy);
  R(x, 30, 114, 20, 6, PAL.ink);
  R(x, 62, 100, 14, 18, '#16264c');
  R(x, 60, 114, 20, 6, '#181822');
  // huge pinstripe jacket
  R(x, 14 - wide, 44, 82 + wide * 2, 60, PAL.navy);
  x.fillStyle = '#3a4f8f';
  for (let i = 18 - wide; i < 94 + wide; i += 7) x.fillRect(i, 46, 1, 56);
  // shirt + tie
  R(x, 44, 46, 22, 52, PAL.white);
  R(x, 51, 48, 8, 30, PAL.red);
  R(x, 51, 48, 8, 4, '#b32e2e');
  // gold chain + $G medallion
  R(x, 34, 58, 42, 3, PAL.gold);
  R(x, 50, 60, 10, 10, PAL.gold);
  R(x, 52, 62, 6, 6, PAL.goldD);
  drawText(x, 'G', 52, 62, 1, PAL.gold);
  // head
  R(x, 22 - wide, 6, 66 + wide, 40, PAL.blue);
  R(x, 22 - wide, 6, 66 + wide, 8, '#325fbb'); // top shade
  R(x, 26 - wide, 34, 62 + wide, 14, PAL.white); // jaw
  R(x, 26 - wide, 32, 62 + wide, 3, PAL.ink); // mouth
  // teeth
  x.fillStyle = PAL.white;
  for (let i = 30 - wide; i < 84 + wide; i += 6) x.fillRect(i, 35, 3, 3);
  // eyes (angry)
  R(x, 60, 18, 8, 7, PAL.white);
  R(x, 63, 21, 3, 3, PAL.ink);
  R(x, 57, 14, 14, 4, PAL.ink); // brow
  // blowhole + spray
  R(x, 42, 2, 8, 3, PAL.blueD);
  // fin arms + briefcase
  if (pose === 'swing') {
    R(x, 92, 56, 14, 10, PAL.blue);
    R(x, 96, 66, 22, 16, '#6b4a2a'); // briefcase
    R(x, 96, 66, 22, 3, '#4e3418');
    R(x, 103, 62, 8, 4, PAL.goldD);
  } else if (pose === 'flop') {
    R(x, 2, 50, 14, 10, PAL.blue);
    R(x, 94 + wide, 50, 14, 10, PAL.blue);
  } else {
    R(x, 6, 54, 10, 26, PAL.blue);
    R(x, 94, 54, 10, 26, PAL.blue);
    R(x, 6, 78, 10, 6, PAL.blueD);
    R(x, 94, 78, 10, 6, PAL.blueD);
  }
  return c;
}

// ---------------- items / obstacles ----------------
function paintChicken(): HTMLCanvasElement {
  const [c, x] = mk(22, 16);
  R(x, 1, 11, 20, 4, PAL.silver); // plate
  R(x, 3, 10, 16, 2, PAL.white);
  R(x, 5, 4, 12, 8, '#b5651d'); // roast
  R(x, 5, 4, 12, 3, '#d98a3c');
  R(x, 15, 2, 5, 3, PAL.white); // bone
  R(x, 16, 5, 3, 3, '#b5651d');
  return c;
}

function paintCoin(kind: 'gonna' | 'algo'): HTMLCanvasElement {
  const [c, x] = mk(12, 12);
  const main = kind === 'gonna' ? PAL.gold : PAL.silver;
  const dark = kind === 'gonna' ? PAL.goldD : PAL.silverD;
  R(x, 2, 0, 8, 12, dark);
  R(x, 0, 2, 12, 8, dark);
  R(x, 2, 1, 8, 10, main);
  R(x, 1, 2, 10, 8, main);
  drawText(x, kind === 'gonna' ? 'G' : 'A', 3, 2, 1, dark);
  return c;
}

function paintLiz1up(): HTMLCanvasElement {
  const [c, x] = mk(18, 14);
  R(x, 2, 6, 10, 6, PAL.gold); // body
  R(x, 11, 4, 6, 6, PAL.gold); // head
  R(x, 15, 6, 3, 3, PAL.white);
  R(x, 0, 8, 3, 3, PAL.goldD); // tail
  R(x, 3, 12, 3, 2, PAL.goldD);
  R(x, 9, 12, 3, 2, PAL.goldD);
  return c;
}

function paintKnife(): HTMLCanvasElement {
  const [c, x] = mk(18, 8);
  R(x, 0, 2, 5, 4, '#6b4a2a'); // handle
  R(x, 5, 1, 2, 6, PAL.goldD); // guard
  R(x, 7, 2, 10, 3, PAL.silver); // blade
  R(x, 15, 3, 3, 2, PAL.white);
  return c;
}

function paintChest(): HTMLCanvasElement {
  const [c, x] = mk(24, 18);
  R(x, 1, 4, 22, 13, '#6b4a2a'); // body
  R(x, 1, 4, 22, 5, '#8a6134'); // lid
  R(x, 1, 8, 22, 2, PAL.gold); // band
  R(x, 10, 8, 4, 5, PAL.gold); // lock
  R(x, 11, 10, 2, 2, PAL.ink);
  R(x, 3, 5, 3, 2, PAL.gold); // shine
  return c;
}

function paintCan(): HTMLCanvasElement {
  const [c, x] = mk(20, 28);
  R(x, 2, 4, 16, 23, PAL.silverD);
  R(x, 2, 4, 16, 3, PAL.silver);
  x.fillStyle = '#6e7380';
  for (let i = 9; i < 25; i += 5) x.fillRect(3, i, 14, 2);
  R(x, 0, 1, 20, 4, PAL.silver); // lid
  R(x, 7, 0, 6, 2, PAL.silverD);
  return c;
}

function paintBarrel(): HTMLCanvasElement {
  const [c, x] = mk(22, 30);
  R(x, 3, 1, 16, 28, '#7a4a22');
  R(x, 1, 4, 20, 22, '#8a5a2a');
  R(x, 1, 4, 20, 3, '#6e431f');
  R(x, 1, 23, 20, 3, '#6e431f');
  R(x, 1, 11, 20, 3, PAL.silverD); // bands
  R(x, 1, 18, 20, 3, PAL.silverD);
  R(x, 5, 7, 3, 3, '#a5723c');
  return c;
}

function paintCrate(): HTMLCanvasElement {
  const [c, x] = mk(24, 24);
  R(x, 0, 0, 24, 24, '#8a5a2a');
  R(x, 2, 2, 20, 20, '#a5723c');
  x.fillStyle = '#8a5a2a';
  for (let i = 0; i < 20; i++) {
    x.fillRect(2 + i, 2 + i, 2, 2);
    x.fillRect(21 - i, 2 + i, 2, 2);
  }
  R(x, 0, 0, 24, 2, '#6e431f');
  R(x, 0, 22, 24, 2, '#6e431f');
  R(x, 0, 0, 2, 24, '#6e431f');
  R(x, 22, 0, 2, 24, '#6e431f');
  return c;
}

function paintLizIcon(): HTMLCanvasElement {
  const [c, x] = mk(12, 10);
  R(x, 1, 2, 9, 7, PAL.green);
  R(x, 7, 4, 5, 4, PAL.green); // snout
  R(x, 2, 0, 2, 3, PAL.greenL);
  R(x, 5, 0, 2, 3, PAL.greenL);
  R(x, 7, 3, 3, 3, PAL.white);
  R(x, 8, 4, 2, 2, PAL.ink);
  return c;
}

export interface Art {
  gecko: HTMLCanvasElement[]; // walk1 walk2 punch
  drone: HTMLCanvasElement[]; // bob1 bob2 dive
  whale: HTMLCanvasElement[]; // walk1 walk2 charge block
  snek: HTMLCanvasElement[]; // walk1 walk2 dash
  boss: Record<'idle' | 'swing' | 'flop', HTMLCanvasElement>;
  chicken: HTMLCanvasElement;
  coinG: HTMLCanvasElement;
  coinA: HTMLCanvasElement;
  liz: HTMLCanvasElement;
  knife: HTMLCanvasElement;
  chest: HTMLCanvasElement;
  can: HTMLCanvasElement;
  barrel: HTMLCanvasElement;
  crate: HTMLCanvasElement;
  lizIcon: HTMLCanvasElement;
}

export function buildArt(): Art {
  return {
    gecko: [paintGecko(0, false), paintGecko(1, false), paintGecko(0, true)],
    drone: [paintDrone(0, false), paintDrone(1, false), paintDrone(0, true)],
    whale: [paintWhale(0, false, false), paintWhale(1, false, false), paintWhale(0, true, false), paintWhale(0, false, true)],
    snek: [paintSnek(0, false), paintSnek(1, false), paintSnek(0, true)],
    boss: { idle: paintBoss('idle'), swing: paintBoss('swing'), flop: paintBoss('flop') },
    chicken: paintChicken(),
    coinG: paintCoin('gonna'),
    coinA: paintCoin('algo'),
    liz: paintLiz1up(),
    knife: paintKnife(),
    chest: paintChest(),
    can: paintCan(),
    barrel: paintBarrel(),
    crate: paintCrate(),
    lizIcon: paintLizIcon(),
  };
}
