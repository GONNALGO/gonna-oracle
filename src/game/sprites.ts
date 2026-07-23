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

interface GeckoPal {
  skin: string;
  skinL: string;
  skinD: string;
  cloth: string;
  clothD: string;
  eye: string;
}

const GECKO_PAL: GeckoPal = { skin: PAL.green, skinL: PAL.greenL, skinD: PAL.greenD, cloth: PAL.purple, clothD: PAL.purpleD, eye: PAL.white };
// NINJA GECKO — black/purple, red eyes
const NINJA_PAL: GeckoPal = { skin: '#4a3a6a', skinL: '#7b4bc9', skinD: '#2e2444', cloth: '#16161e', clothD: '#0c0c12', eye: '#ff5a5a' };

function paintGecko(legFrame: number, punch: boolean, pal: GeckoPal = GECKO_PAL): HTMLCanvasElement {
  const [c, x] = mk(34, 54);
  // tail
  R(x, 2, 30, 6, 4, pal.skin);
  R(x, 0, 32, 4, 3, pal.skinD);
  // far arm
  R(x, 8, 20, 4, 9, pal.skinD);
  // legs
  const a = legFrame ? 2 : 0;
  R(x, 10, 38, 5, 11 - a, '#23232e');
  R(x, 9, 47 - a, 7, 4, PAL.ink);
  R(x, 18, 38, 5, 11 - (legFrame ? 0 : 2), '#2e2e3c');
  R(x, 17, 47 - (legFrame ? 0 : 2), 7, 4, '#181822');
  // hood behind head
  R(x, 8, 8, 7, 11, pal.clothD);
  // torso hoodie
  R(x, 8, 17, 16, 21, pal.cloth);
  R(x, 8, 17, 16, 3, pal.clothD);
  R(x, 11, 30, 10, 6, pal.clothD); // pocket
  // head
  R(x, 12, 4, 14, 12, pal.skin);
  R(x, 20, 8, 9, 6, pal.skin); // snout
  R(x, 24, 13, 5, 2, pal.skinD); // jaw
  R(x, 13, 2, 3, 3, pal.skinL);
  R(x, 17, 1, 3, 4, pal.skinL);
  R(x, 21, 2, 3, 3, pal.skinL); // crest
  R(x, 21, 6, 4, 4, pal.eye);
  R(x, 23, 7, 2, 2, PAL.ink); // eye
  R(x, 12, 16, 10, 2, PAL.gold); // chain
  // near arm
  if (punch) {
    R(x, 22, 20, 8, 5, pal.skin);
    R(x, 30, 19, 4, 6, pal.skinL); // fist
  } else {
    R(x, 21, 20, 4, 10, pal.skin);
    R(x, 21, 29, 4, 4, pal.skinL);
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

function paintWhale(legFrame: number, charge: boolean, block: boolean, bouncer = false): HTMLCanvasElement {
  const [c, x] = mk(50, 66);
  const lean = charge ? 5 : 0;
  const jacket = bouncer ? '#16161e' : PAL.blueD;
  const jacketD = bouncer ? '#0c0c12' : '#1e3c74';
  const pants = bouncer ? '#1a1a26' : PAL.navy;
  const pantsD = bouncer ? '#12121c' : '#16264c';
  const tie = bouncer ? PAL.purple : PAL.red;
  // shoes + pants
  const a = legFrame ? 2 : 0;
  R(x, 14, 56, 8, 8 - a, pants);
  R(x, 12, 62 - a, 11, 4, PAL.ink);
  R(x, 28, 56, 8, 8 - (legFrame ? 0 : 2), pantsD);
  R(x, 26, 62 - (legFrame ? 0 : 2), 11, 4, '#181822');
  // jacket (big torso)
  R(x, 8 + lean, 24, 34, 34, jacket);
  R(x, 8 + lean, 24, 34, 4, jacketD);
  // shirt
  R(x, 22 + lean, 26, 8, 26, bouncer ? '#2a2a3a' : PAL.white);
  R(x, 25 + lean, 28, 3, 14, tie); // tie
  // buttons
  R(x, 14 + lean, 40, 2, 2, PAL.gold);
  R(x, 14 + lean, 48, 2, 2, PAL.gold);
  // far fin arm
  R(x, 6 + lean, 30, 5, 16, jacket);
  // head
  R(x, 12 + lean, 2, 26, 22, PAL.blue);
  R(x, 34 + lean, 10, 10, 10, PAL.blue); // snout
  R(x, 14 + lean, 18, 30, 7, PAL.white); // jaw
  R(x, 14 + lean, 17, 30, 2, PAL.ink); // mouth line
  if (bouncer) {
    R(x, 28 + lean, 7, 12, 5, PAL.ink); // sunglasses
    R(x, 38 + lean, 8, 3, 2, PAL.ink);
  } else {
    R(x, 30 + lean, 8, 5, 5, PAL.white);
    R(x, 32 + lean, 10, 2, 2, PAL.ink); // eye
  }
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

interface SnekPal {
  skin: string;
  skinD: string;
  blade: boolean; // knife (knife snek) vs coin (coin snek)
}

const SNEK_PAL: SnekPal = { skin: PAL.green, skinD: PAL.greenD, blade: true };
// COIN SNEK — solid gold, spits $GONNA coins
const COIN_PAL: SnekPal = { skin: PAL.gold, skinD: PAL.goldD, blade: false };

function paintSnek(frame: number, dash: boolean, pal: SnekPal = SNEK_PAL): HTMLCanvasElement {
  const [c, x] = mk(40, 26);
  if (dash) {
    // stretched dash body
    R(x, 0, 16, 26, 5, pal.skin);
    R(x, 0, 19, 26, 2, pal.skinD);
    R(x, 24, 12, 10, 8, pal.skin); // head forward
    R(x, 28, 10, 6, 3, pal.skinD); // hood
    R(x, 31, 14, 3, 3, PAL.white);
    R(x, 32, 15, 2, 2, PAL.ink);
    if (pal.blade) {
      // knife
      R(x, 34, 14, 6, 2, PAL.silver);
      R(x, 33, 13, 2, 4, '#6b4a2a');
    } else {
      // coin in mouth
      R(x, 34, 13, 5, 5, PAL.gold);
      R(x, 35, 14, 3, 3, PAL.goldD);
    }
  } else {
    // coiled body S-curve
    const s = frame ? 1 : 0;
    R(x, 2, 18, 14, 4, pal.skin);
    R(x, 4 + s, 14, 14, 4, pal.skin);
    R(x, 6, 21, 16, 3, pal.skinD);
    R(x, 10 + s, 11, 12, 4, pal.skinD);
    // raised head w/ hood
    R(x, 22 + s, 4, 10, 12, pal.skin);
    R(x, 20 + s, 4, 4, 10, pal.skinD); // hood L
    R(x, 30 + s, 4, 4, 10, pal.skinD); // hood R
    R(x, 28 + s, 7, 3, 3, PAL.white);
    R(x, 29 + s, 8, 2, 2, PAL.ink);
    R(x, 26 + s, 15, 6, 2, PAL.red); // tongue
    if (pal.blade) {
      // knife held high
      R(x, 33 + s, 2, 5, 2, PAL.silver);
      R(x, 32 + s, 1, 2, 4, '#6b4a2a');
    } else {
      // coin held high
      R(x, 33 + s, 1, 5, 5, PAL.gold);
      R(x, 34 + s, 2, 3, 3, PAL.goldD);
    }
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

// ---------------- boss: SLOT GOLEM (Stage 5) ----------------
function paintGolem(pose: 'idle' | 'attack' | 'stomp'): HTMLCanvasElement {
  const [c, x] = mk(92, 108);
  const lean = pose === 'stomp' ? 4 : 0;
  // legs: slot cabinets
  R(x, 20, 78, 24, 28, '#5a1010');
  R(x, 22, 80, 20, 24, '#7a1a2a');
  R(x, 48, 78, 24, 28, '#5a1010');
  R(x, 50, 80, 20, 24, '#7a1a2a');
  R(x, 18, 102, 28, 6, PAL.goldD); // gold feet
  R(x, 46, 102, 28, 6, PAL.goldD);
  R(x, 24, 86, 16, 8, PAL.ink); // leg reel windows
  R(x, 52, 86, 16, 8, PAL.ink);
  drawText(x, '7', 30, 87, 1, PAL.gold);
  drawText(x, 'G', 58, 87, 1, PAL.gold);
  // torso: big slot machine cabinet
  R(x, 12 - lean, 30, 66, 50, '#7a1a2a');
  R(x, 12 - lean, 30, 66, 4, '#93222f');
  R(x, 12 - lean, 30, 4, 50, PAL.goldD);
  R(x, 74 - lean, 30, 4, 50, PAL.goldD);
  // 3 reel windows
  R(x, 18 - lean, 40, 54, 18, PAL.ink);
  const sym = pose === 'attack' ? ['7', '7', '7'] : ['G', '7', 'G'];
  drawText(x, sym[0], 23 - lean, 44, 2, PAL.gold);
  drawText(x, sym[1], 41 - lean, 44, 2, pose === 'attack' ? '#ff6b6b' : PAL.gold);
  drawText(x, sym[2], 59 - lean, 44, 2, PAL.gold);
  // coin tray
  R(x, 20 - lean, 64, 50, 8, PAL.goldD);
  R(x, 22 - lean, 65, 46, 5, PAL.gold);
  // head: coin hopper
  R(x, 30 - lean, 12, 30, 18, '#93222f');
  R(x, 30 - lean, 12, 30, 3, PAL.gold);
  R(x, 36 - lean, 16, 6, 6, PAL.gold); // coin eyes
  R(x, 50 - lean, 16, 6, 6, PAL.gold);
  R(x, 38 - lean, 18, 2, 2, PAL.ink);
  R(x, 52 - lean, 18, 2, 2, PAL.ink);
  R(x, 36 - lean, 26, 20, 2, PAL.ink); // mouth
  // crown of coins
  R(x, 28 - lean, 6, 34, 6, PAL.gold);
  R(x, 32 - lean, 2, 6, 6, PAL.gold);
  R(x, 44 - lean, 0, 6, 8, PAL.gold);
  R(x, 54 - lean, 2, 6, 6, PAL.gold);
  // arms
  if (pose === 'attack') {
    R(x, 76 - lean, 40, 14, 10, '#93222f');
    R(x, 88 - lean, 38, 10, 10, PAL.gold); // coin fist
    R(x, 4 - lean, 40, 10, 30, '#93222f');
  } else if (pose === 'stomp') {
    R(x, 2 - lean, 34, 10, 26, '#93222f');
    R(x, 78 - lean, 34, 10, 26, '#93222f');
  } else {
    R(x, 4, 40, 10, 30, '#93222f');
    R(x, 78, 40, 10, 30, '#93222f');
    R(x, 4, 68, 10, 8, PAL.gold);
    R(x, 78, 68, 10, 8, PAL.gold);
    // lever
    R(x, 86, 34, 3, 18, PAL.silverD);
    R(x, 84, 30, 7, 6, PAL.red);
  }
  return c;
}

// ---------------- final boss: EMPEROR FUD (Stage 6) ----------------
function paintFud(pose: 'idle' | 'swing' | 'charge' | 'slam'): HTMLCanvasElement {
  const [c, x] = mk(130, 150);
  const lean = pose === 'charge' ? 8 : 0;
  // purple mantle
  R(x, 20 - lean, 60, 90, 86, PAL.purpleD);
  R(x, 26 - lean, 64, 78, 78, PAL.purple);
  R(x, 20 - lean, 60, 90, 5, PAL.gold); // gold trim
  R(x, 20 - lean, 141, 90, 5, PAL.goldD);
  for (let i = 32; i < 100; i += 16) R(x, i - lean, 104, 6, 6, PAL.gold); // gold studs
  // chest + medallion
  R(x, 52 - lean, 70, 26, 40, '#93222f');
  R(x, 60 - lean, 78, 12, 12, PAL.gold);
  drawText(x, 'F', 62 - lean, 80, 2, PAL.goldD);
  // head
  R(x, 44 - lean, 22, 42, 36, '#e8c49a');
  // corrupted red eyes
  R(x, 52 - lean, 34, 8, 6, '#e23b3b');
  R(x, 72 - lean, 34, 8, 6, '#e23b3b');
  R(x, 55 - lean, 36, 3, 3, PAL.ink);
  R(x, 75 - lean, 36, 3, 3, PAL.ink);
  R(x, 50 - lean, 30, 12, 3, PAL.ink); // brows
  R(x, 70 - lean, 30, 12, 3, PAL.ink);
  // white beard
  R(x, 46 - lean, 46, 38, 14, '#e8e4d8');
  R(x, 52 - lean, 58, 26, 8, '#d8d4c8');
  R(x, 58 - lean, 48, 14, 4, PAL.ink); // mouth
  // gold crown
  R(x, 42 - lean, 12, 46, 10, PAL.gold);
  R(x, 44 - lean, 4, 8, 10, PAL.gold);
  R(x, 60 - lean, 0, 10, 14, PAL.gold);
  R(x, 78 - lean, 4, 8, 10, PAL.gold);
  R(x, 46 - lean, 6, 4, 4, '#e23b3b'); // jewels
  R(x, 63 - lean, 3, 4, 4, '#3b6fd4');
  R(x, 80 - lean, 6, 4, 4, '#3fae4a');
  // shoulders
  R(x, 16 - lean, 56, 20, 14, PAL.goldD);
  R(x, 94 - lean, 56, 20, 14, PAL.goldD);
  // arms + scepter
  if (pose === 'swing') {
    R(x, 96 - lean, 44, 12, 26, PAL.purple);
    R(x, 110 - lean, 20, 5, 56, PAL.gold); // scepter swung forward
    R(x, 106 - lean, 12, 13, 10, '#e23b3b');
    R(x, 108 - lean, 14, 9, 6, '#ff6b6b');
    R(x, 10 - lean, 66, 12, 34, PAL.purple);
  } else if (pose === 'slam') {
    R(x, 8 - lean, 36, 12, 28, PAL.purple); // both arms up
    R(x, 110 - lean, 36, 12, 28, PAL.purple);
    R(x, 14 - lean, 20, 5, 20, PAL.gold);
    R(x, 10 - lean, 12, 13, 10, '#e23b3b');
    R(x, 113 - lean, 20, 5, 20, PAL.gold);
    R(x, 109 - lean, 12, 13, 10, '#e23b3b');
  } else {
    R(x, 10 - lean, 66, 12, 34, PAL.purple);
    R(x, 108 - lean, 66, 12, 34, PAL.purple);
    R(x, 114 - lean, 30, 5, 76, PAL.gold); // scepter at side
    R(x, 110 - lean, 22, 13, 10, '#e23b3b');
    R(x, 112 - lean, 24, 9, 6, '#ff6b6b');
  }
  // feet
  R(x, 36, 144, 16, 6, PAL.ink);
  R(x, 78, 144, 16, 6, PAL.ink);
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
  drawText(x, 'G', 8, 14, 1, PAL.gold); // $GONNA brand
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
  drawText(x, 'A', 9, 9, 1, PAL.greenD); // $ALGO brand
  return c;
}

// CONCRETE SAFE — heavy, tall, NOT liftable
function paintSafe(): HTMLCanvasElement {
  const [c, x] = mk(26, 40);
  R(x, 1, 0, 24, 40, PAL.silverD);
  R(x, 1, 0, 24, 3, PAL.silver); // top highlight
  R(x, 1, 37, 24, 3, '#5a5f6c'); // base shade
  R(x, 3, 5, 20, 30, '#9aa0ac'); // door inset
  R(x, 3, 5, 20, 2, PAL.silver);
  // rivets
  x.fillStyle = '#6e7380';
  for (const [rx, ry] of [[5, 7], [20, 7], [5, 32], [20, 32]] as const) x.fillRect(rx, ry, 2, 2);
  // cracks
  R(x, 15, 12, 1, 6, '#6e7380');
  R(x, 16, 17, 3, 1, '#6e7380');
  R(x, 8, 22, 1, 5, '#787d88');
  // gold combo dial
  R(x, 10, 14, 6, 6, PAL.goldD);
  R(x, 11, 15, 4, 4, PAL.gold);
  R(x, 12, 16, 2, 2, PAL.ink);
  return c;
}

// CASINO CHIP STACK — gold $GONNA chips (casino lane object)
function paintChips(): HTMLCanvasElement {
  const [c, x] = mk(22, 18);
  for (let i = 0; i < 3; i++) {
    const yy = 13 - i * 5;
    R(x, 3, yy, 16, 5, PAL.goldD);
    R(x, 3, yy, 16, 3, PAL.gold);
    R(x, 2, yy + 1, 2, 3, PAL.white);
    R(x, 18, yy + 1, 2, 3, PAL.white);
  }
  drawText(x, 'G', 9, 1, 1, PAL.goldD);
  return c;
}

// OIL DRUM — explosive
function paintDrum(): HTMLCanvasElement {
  const [c, x] = mk(22, 30);
  R(x, 3, 1, 16, 28, '#8a2a1e');
  R(x, 1, 4, 20, 22, '#b33a2a');
  R(x, 1, 4, 20, 3, '#7a2218'); // top rim shade
  R(x, 1, 23, 20, 3, '#7a2218');
  R(x, 1, 10, 20, 2, '#d8d4c8'); // ribs
  R(x, 1, 19, 20, 2, '#d8d4c8');
  // hazard band
  R(x, 1, 13, 20, 5, PAL.gold);
  x.fillStyle = PAL.ink;
  for (let i = 0; i < 5; i++) x.fillRect(2 + i * 4, 13, 2, 5);
  R(x, 5, 6, 3, 3, '#d95a3c'); // highlight
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
  ninja: HTMLCanvasElement[]; // walk1 walk2 dash (v3)
  coinsnek: HTMLCanvasElement[]; // walk1 walk2 spit (v3)
  bouncer: HTMLCanvasElement[]; // walk1 walk2 charge block (v3)
  boss: Record<'idle' | 'swing' | 'flop', HTMLCanvasElement>;
  golem: Record<'idle' | 'attack' | 'stomp', HTMLCanvasElement>;
  fud: Record<'idle' | 'swing' | 'charge' | 'slam', HTMLCanvasElement>;
  chicken: HTMLCanvasElement;
  coinG: HTMLCanvasElement;
  coinA: HTMLCanvasElement;
  liz: HTMLCanvasElement;
  knife: HTMLCanvasElement;
  chest: HTMLCanvasElement;
  can: HTMLCanvasElement;
  barrel: HTMLCanvasElement;
  crate: HTMLCanvasElement;
  safe: HTMLCanvasElement;
  drum: HTMLCanvasElement;
  chips: HTMLCanvasElement;
  lizIcon: HTMLCanvasElement;
}

export function buildArt(): Art {
  return {
    gecko: [paintGecko(0, false), paintGecko(1, false), paintGecko(0, true)],
    drone: [paintDrone(0, false), paintDrone(1, false), paintDrone(0, true)],
    whale: [paintWhale(0, false, false), paintWhale(1, false, false), paintWhale(0, true, false), paintWhale(0, false, true)],
    snek: [paintSnek(0, false), paintSnek(1, false), paintSnek(0, true)],
    ninja: [paintGecko(0, false, NINJA_PAL), paintGecko(1, false, NINJA_PAL), paintGecko(0, true, NINJA_PAL)],
    coinsnek: [paintSnek(0, false, COIN_PAL), paintSnek(1, false, COIN_PAL), paintSnek(0, true, COIN_PAL)],
    bouncer: [paintWhale(0, false, false, true), paintWhale(1, false, false, true), paintWhale(0, true, false, true), paintWhale(0, false, true, true)],
    boss: { idle: paintBoss('idle'), swing: paintBoss('swing'), flop: paintBoss('flop') },
    golem: { idle: paintGolem('idle'), attack: paintGolem('attack'), stomp: paintGolem('stomp') },
    fud: { idle: paintFud('idle'), swing: paintFud('swing'), charge: paintFud('charge'), slam: paintFud('slam') },
    chicken: paintChicken(),
    coinG: paintCoin('gonna'),
    coinA: paintCoin('algo'),
    liz: paintLiz1up(),
    knife: paintKnife(),
    chest: paintChest(),
    can: paintCan(),
    barrel: paintBarrel(),
    crate: paintCrate(),
    safe: paintSafe(),
    drum: paintDrum(),
    chips: paintChips(),
    lizIcon: paintLizIcon(),
  };
}
