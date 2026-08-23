// v15.1.1: visible build version badge. window.__GONNA_VER is injected into
// dist/index.html by scripts/vault-door.mjs at build time ('v' + entry
// content hash, same VER as payload-<VER>.dat / sw-<VER>.js). Fallback 'DEV'
// for unpatched dev builds. RENDER-ONLY: reads a global, never touches the
// sim — campaign byte-equivalence and descent determinism are unaffected.
import { drawText } from './font';
import { VW } from './types';

export function buildVer(): string {
  const v = (globalThis as { __GONNA_VER?: unknown }).__GONNA_VER;
  return typeof v === 'string' && v ? v : 'DEV';
}

// Small, unobtrusive badge: 5x7 pixel font, 1px scale, DIM color,
// bottom-right corner (right-aligned at VW-8, above the mosaic border).
export function drawVerBadge(ctx: CanvasRenderingContext2D, y: number, color = '#5a5f6c'): void {
  drawText(ctx, buildVer(), VW - 8, y, 1, color, 'right');
}
