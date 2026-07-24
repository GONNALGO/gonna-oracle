// <Game/> — v6.1: TRUE full-bleed canvas. The canvas element always covers the
// whole viewport (position:fixed, inset:0, 100% x 100dvh); the 384x224 game
// view is letterboxed INSIDE the canvas by the render transform (see fit.ts).
// iPhone Safari has no requestFullscreen(): instead we refit on every
// resize / orientationchange / visualViewport change (+ legacy scrollTo(0,1))
// so the layout can NEVER get stuck after rotation. Fixed 60Hz logic.
import { useEffect, useRef } from 'react';
import { Game } from './engine';
import { isTouchDevice } from './touch';
import { computeFit } from './fit';
import { VH, VW } from './types';

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let game: Game | null = null;
    let raf = 0;
    let alive = true;
    let acc = 0;
    let last = performance.now();
    const STEP = 1000 / 60;
    const timers: number[] = [];

    // refit the canvas backing store + game view to the CURRENT viewport
    const refit = () => {
      const vv = window.visualViewport;
      const w = Math.max(1, Math.round(vv ? vv.width : window.innerWidth));
      const h = Math.max(1, Math.round(vv ? vv.height : window.innerHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const pw = Math.max(1, Math.round(w * dpr));
      const ph = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      if (game) game.setViewport(computeFit(w, h, dpr, isTouchDevice(), game.zoomOn));
    };
    // rotation on iOS settles in steps (chrome collapse) — refit immediately,
    // then twice more, and nudge the legacy scroll trick. Never stuck.
    const onOrient = () => {
      try {
        window.scrollTo(0, 1);
      } catch { /* ignore */ }
      refit();
      timers.push(window.setTimeout(refit, 80));
      timers.push(window.setTimeout(refit, 320));
    };

    const loop = (now: number) => {
      if (!alive || !game) return;
      acc += Math.min(100, now - last); // clamp spiral of death
      last = now;
      while (acc >= STEP) {
        game.step();
        acc -= STEP;
      }
      game.render();
      game.renderTouch(); // touch controls overlay (no-op on desktop)
      raf = requestAnimationFrame(loop);
    };

    Game.boot(canvas).then((g) => {
      if (!alive) {
        g.destroy();
        return;
      }
      game = g;
      (window as unknown as { __gonna: Game }).__gonna = g; // test hook
      g.onFitChange = refit; // ZOOM toggle re-fits immediately
      refit();
      last = performance.now();
      raf = requestAnimationFrame(loop);
    });

    refit(); // size the backing store before boot completes
    window.addEventListener('resize', onOrient);
    window.addEventListener('orientationchange', onOrient);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', refit);
      vv.addEventListener('scroll', refit);
    }

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      for (const t of timers) window.clearTimeout(t);
      window.removeEventListener('resize', onOrient);
      window.removeEventListener('orientationchange', onOrient);
      if (vv) {
        vv.removeEventListener('resize', refit);
        vv.removeEventListener('scroll', refit);
      }
      if (game) game.destroy();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={VW}
      height={VH}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100dvh', // dynamic viewport height: follows iOS chrome collapse
        imageRendering: 'pixelated',
        background: '#000',
        touchAction: 'none', // no scroll / pull-to-refresh / double-tap zoom
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    />
  );
}
