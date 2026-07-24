// <Game/> — mounts one 384x224 canvas, letterboxed, pixelated, fixed 60Hz logic.
// v6: touch hardening — no scroll/zoom on the canvas, gentle non-blocking
// "RUOTA IL TELEFONO" overlay in portrait on touch devices (desktop untouched).
import { useEffect, useRef } from 'react';
import { Game } from './engine';
import { isTouchDevice } from './touch';
import { VH, VW } from './types';

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let game: Game | null = null;
    let raf = 0;
    let alive = true;
    let acc = 0;
    let last = performance.now();
    const STEP = 1000 / 60;

    const loop = (now: number) => {
      if (!alive || !game) return;
      acc += Math.min(100, now - last); // clamp spiral of death
      last = now;
      while (acc >= STEP) {
        game.step();
        acc -= STEP;
      }
      game.render();
      game.renderTouch(); // v6: canvas-overlay touch controls (no-op on desktop)
      raf = requestAnimationFrame(loop);
    };

    Game.boot(canvas).then((g) => {
      if (!alive) {
        g.destroy();
        return;
      }
      game = g;
      (window as unknown as { __gonna: Game }).__gonna = g; // test hook
      last = performance.now();
      raf = requestAnimationFrame(loop);
    });

    // v6: portrait rotate hint — touch devices only, non-blocking
    const mq = window.matchMedia('(orientation: portrait)');
    const touch = isTouchDevice();
    const rotateEl = rotateRef.current;
    const syncRotate = () => {
      if (rotateEl) rotateEl.style.display = touch && mq.matches ? 'flex' : 'none';
    };
    syncRotate();
    if (mq.addEventListener) mq.addEventListener('change', syncRotate);
    else mq.addListener(syncRotate);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (mq.removeEventListener) mq.removeEventListener('change', syncRotate);
      else mq.removeListener(syncRotate);
      if (game) game.destroy();
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#05060a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        width={VW}
        height={VH}
        style={{
          width: 'min(100vw, 171.4vh)',
          height: 'min(58.33vw, 100vh)',
          imageRendering: 'pixelated',
          background: '#000',
          touchAction: 'none', // v6: no scroll / pull-to-refresh / double-tap zoom
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      />
      {/* v6: gentle rotate hint (touch + portrait only, never blocks input) */}
      <div
        id="rotate-overlay"
        ref={rotateRef}
        style={{
          display: 'none',
          position: 'fixed',
          top: 'max(12px, env(safe-area-inset-top))',
          left: '50%',
          transform: 'translateX(-50%)',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          padding: '10px 18px',
          background: 'rgba(5,6,10,0.72)',
          border: '2px solid #f5c542',
          borderRadius: 4,
          pointerEvents: 'none', // non-blocking by design
          zIndex: 10,
          fontFamily: 'monospace',
          color: '#f5c542',
          letterSpacing: 2,
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: 26, lineHeight: 1 }}>&#8635;</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>RUOTA IL TELEFONO</span>
      </div>
    </div>
  );
}
