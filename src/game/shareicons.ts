// v9.2 — the OFFICIAL X (𝕏) and Telegram paper-plane logos, redrawn by hand
// as 16x16 pixel art. Drawn FLUO GREEN #39FF14 with a subtle glow on the
// black share buttons (pressed = 1-frame green->white flash handled by the
// caller drawing with color '#ffffff').
export const FLUO = '#39FF14';

// 𝕏 — two bold diagonal strokes (official X mark, pixel-redrawn)
const X_BMP = [
  'XX............XX',
  'XXX..........XXX',
  '.XXX........XXX.',
  '..XXX......XXX..',
  '...XXX....XXX...',
  '....XXX..XXX....',
  '.....XXXXXX.....',
  '......XXXX......',
  '......XXXX......',
  '.....XXXXXX.....',
  '....XXX..XXX....',
  '...XXX....XXX...',
  '..XXX......XXX..',
  '.XXX........XXX.',
  'XXX..........XXX',
  'XX............XX',
];

// Telegram paper plane — dart nose to the right, swept wing, tail notch
const TG_BMP = [
  'PP..............',
  'PPPP............',
  'PPPPPP..........',
  'PPPPPPPP........',
  'PPPPPPPPPP......',
  'PPPPPPPPPPPP....',
  'PPPPPPPPPPPPPP..',
  'PPPPPPPPPPPPPPPP',
  'PPPPPPPPPPPPPPP.',
  '.....PPPPPPPPP..',
  '.......PPPP.PP..',
  '.........PPPP...',
  '.........PPP....',
  '........PPP.....',
  '........PP......',
  '................',
];

function drawBmp(ctx: CanvasRenderingContext2D, bmp: string[], mark: string, x: number, y: number, s: number, color: string, glow: boolean): void {
  if (glow) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = s * 3;
  }
  ctx.fillStyle = color;
  for (let r = 0; r < bmp.length; r++) {
    const row = bmp[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === mark) ctx.fillRect(x + c * s, y + r * s, s, s);
    }
  }
  if (glow) ctx.restore();
}

// x,y = top-left of the 16x16 glyph; s = pixel size (1 = 16px glyph)
export function drawIconX(ctx: CanvasRenderingContext2D, x: number, y: number, s = 1, color = FLUO, glow = true): void {
  drawBmp(ctx, X_BMP, 'X', x, y, s, color, glow);
}
export function drawIconTG(ctx: CanvasRenderingContext2D, x: number, y: number, s = 1, color = FLUO, glow = true): void {
  drawBmp(ctx, TG_BMP, 'P', x, y, s, color, glow);
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
  drawBmp(ctx, CHECK_BMP, 'C', x, y, s, color, false);
}
