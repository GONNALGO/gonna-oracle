// v9.2.2 — the OFFICIAL X (𝕏) and Telegram paper-plane logos, redrawn BIGGER
// (18x18 grid, up from the unreadable 16x16) as clean official silhouettes.
// Solid FLUO GREEN #39FF14 with a subtle glow on the black share buttons
// (pressed = 1-frame green->white flash handled by the caller drawing with
// color '#ffffff'). Bitmaps are pre-rendered to a cached offscreen canvas so
// the per-frame cost is ONE drawImage (shadowBlur glow is baked at cache time,
// never per frame — mobile-Safari safe).
export const FLUO = '#39FF14';

// 𝕏 — two bold 3px diagonal strokes (official X mark, pixel-redrawn)
const X_BMP = [
  'XX..............XX',
  'XXX............XXX',
  '.XXX..........XXX.',
  '..XXX........XXX..',
  '...XXX......XXX...',
  '....XXX....XXX....',
  '.....XXX..XXX.....',
  '......XXXXXX......',
  '.......XXXX.......',
  '.......XXXX.......',
  '......XXXXXX......',
  '.....XXX..XXX.....',
  '....XXX....XXX....',
  '...XXX......XXX...',
  '..XXX........XXX..',
  '.XXX..........XXX.',
  'XXX............XXX',
  'XX..............XX',
];

// Telegram paper plane — the OFFICIAL silhouette (Font Awesome telegram-plane
// path, 448x512 viewBox) rasterized onto the 18x18 grid with the nonzero
// winding rule so the signature fold slit stays open. Nose up-right.
const TG_BMP = [
  '..................',
  '...............P..',
  '.............PPP..',
  '...........PPPPPP.',
  '..........PPPPPPP.',
  '........PPPPPPPPP.',
  '......PPPPPPPPPPP.',
  '....PPPPPPP.PPPP..',
  '..PPPPPPP..PPPPP..',
  '.PPPPPPP..PPPPPP..',
  '..PPPP...PPPPPPP..',
  '........PPPPPPPP..',
  '.......PPPPPPPP...',
  '.......PPPPPPPP...',
  '.......PP.PPPPP...',
  '.......P...PPPP...',
  '............PP....',
  '..................',
];

const GLOW_PAD = 3; // glow bleed around the glyph (game px)
const cache = new Map<string, HTMLCanvasElement>();

function iconCanvas(bmp: string[], mark: string, color: string, glow: boolean): HTMLCanvasElement {
  const key = mark + '|' + color + '|' + (glow ? 'g' : 'f') + '|' + bmp.length;
  let cv = cache.get(key);
  if (cv) return cv;
  const pad = glow ? GLOW_PAD : 0;
  cv = document.createElement('canvas');
  cv.width = bmp[0].length + pad * 2;
  cv.height = bmp.length + pad * 2;
  const c = cv.getContext('2d')!;
  if (glow) {
    c.shadowColor = color;
    c.shadowBlur = 3;
  }
  c.fillStyle = color;
  for (let r = 0; r < bmp.length; r++) {
    const row = bmp[r];
    for (let col = 0; col < row.length; col++) {
      if (row[col] === mark) c.fillRect(pad + col, pad + r, 1, 1);
    }
  }
  cache.set(key, cv);
  return cv;
}

function drawIcon(ctx: CanvasRenderingContext2D, bmp: string[], mark: string, x: number, y: number, s: number, color: string, glow: boolean): void {
  const cv = iconCanvas(bmp, mark, color, glow);
  const pad = glow ? GLOW_PAD : 0;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cv, Math.round(x - pad * s), Math.round(y - pad * s), cv.width * s, cv.height * s);
  ctx.imageSmoothingEnabled = prev;
}

// x,y = top-left of the 18x18 glyph; s = pixel size (1 = 18px glyph)
export function drawIconX(ctx: CanvasRenderingContext2D, x: number, y: number, s = 1, color = FLUO, glow = true): void {
  drawIcon(ctx, X_BMP, 'X', x, y, s, color, glow);
}
export function drawIconTG(ctx: CanvasRenderingContext2D, x: number, y: number, s = 1, color = FLUO, glow = true): void {
  drawIcon(ctx, TG_BMP, 'P', x, y, s, color, glow);
}

// v9.2.1 — pixel checkmark for the POSTED! state. The pixel font is
// ASCII-only, so the old ✓ glyph rendered as garbage ("0K"): the check is a
// DRAWN sprite now, never a font character.
const CHECK_BMP = [
  '.....CC',
  '....CC.',
  '...CC..',
  'C.CC...',
  'CCC....',
  '.C.....',
];
// x,y = top-left of the 7x6 glyph; s = pixel size
export function drawCheck(ctx: CanvasRenderingContext2D, x: number, y: number, s = 1, color = FLUO): void {
  ctx.fillStyle = color;
  for (let r = 0; r < CHECK_BMP.length; r++) {
    const row = CHECK_BMP[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === 'C') ctx.fillRect(x + c * s, y + r * s, s, s);
    }
  }
}

// v9.2.2 — shared share-button geometry (single source of truth for the draw
// sites in screens.ts / boardui.ts AND the CI no-overlap assertion): the
// 18x18 icon sits at the LEFT of the button, the POSTED check hugs the RIGHT
// edge — they can never overlap again.
export const SHARE_BTN_H = 20; // taller buttons so the 18px icons breathe
export function shareIconRect(b: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  return { x: b.x + 5, y: b.y + 1, w: 18, h: 18 };
}
export function shareCheckRect(b: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  return { x: b.x + b.w - 12, y: b.y + Math.floor((b.h - 6) / 2), w: 7, h: 6 };
}
