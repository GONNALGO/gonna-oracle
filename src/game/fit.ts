// v6.1 — viewport fit / internal letterbox math.
// The canvas element is ALWAYS full-bleed (position:fixed, inset:0, 100% x 100dvh).
// The 384x224 game view is fitted INSIDE the canvas by the render transform:
//   screenX(css) = offX + (gameX - cropX) * scale
//   screenY(css) = offY + gameY * scale
// Everything outside the game view stays black (filled in device space).
//
// Layouts:
// - desktop          : centered letterbox on both axes (identical to v1..v6).
// - touch landscape  : full height, centered horizontally (side bars only as
//                      the aspect ratio requires). No more stuck 668px canvas.
// - touch portrait   : FIT = full width, anchored to the TOP of the screen so
//                      the lower ~65% is free for big touch controls.
//                      ZOOM = scale fills half the screen height, stage sides
//                      are cropped (cropX keeps the player centered, clamped
//                      to the stage view bounds). HUD is always drawn uncropped.

import { VH, VW } from './types';

export const PORTRAIT_TOP = 8; // css px: top margin for the portrait game view
export const ZOOM_H = 0.5; // fraction of viewport height the game fills in ZOOM

export interface ViewFit {
  cssW: number; // viewport size (CSS px)
  cssH: number;
  dpr: number;
  // effective transform for the current frame mode (zoom ? zoom : fit)
  scale: number;
  offX: number;
  offY: number;
  // plain FIT transform (whole stage visible) — also used for HUD + zoom fallback
  fitScale: number;
  fitOffX: number;
  fitOffY: number;
  // ZOOM mode numbers (valid when zoom === true)
  zoomScale: number;
  zoomVisW: number; // visible stage width in game px when zoomed (< VW)
  portrait: boolean;
  touch: boolean;
  zoom: boolean; // zoom requested AND applicable (portrait touch only)
}

export function computeFit(cssW: number, cssH: number, dpr: number, touch: boolean, zoomOn: boolean): ViewFit {
  const portrait = cssH > cssW;
  let fitScale: number;
  let fitOffX: number;
  let fitOffY: number;
  if (!touch) {
    // desktop: centered letterbox, byte-identical look to v1..v6
    fitScale = Math.min(cssW / VW, cssH / VH);
    fitOffX = (cssW - VW * fitScale) / 2;
    fitOffY = (cssH - VH * fitScale) / 2;
  } else if (portrait) {
    // portrait touch: full width, anchored at the top; controls live below
    fitScale = cssW / VW;
    fitOffX = 0;
    fitOffY = PORTRAIT_TOP;
  } else {
    // landscape touch: full height (side bars only as the aspect requires)
    fitScale = Math.min(cssW / VW, cssH / VH);
    fitOffX = Math.max(0, (cssW - VW * fitScale) / 2);
    fitOffY = Math.max(0, (cssH - VH * fitScale) / 2); // 0 in any real landscape
  }
  const zoom = touch && portrait && zoomOn;
  const zoomScale = Math.max(fitScale, (cssH * ZOOM_H) / VH);
  const zoomVisW = cssW / zoomScale;
  return {
    cssW,
    cssH,
    dpr,
    scale: zoom ? zoomScale : fitScale,
    offX: zoom ? 0 : fitOffX, // zoom centers the cropped window via cropX
    offY: fitOffY,
    fitScale,
    fitOffX,
    fitOffY,
    zoomScale,
    zoomVisW,
    portrait,
    touch,
    zoom,
  };
}
