// <Game/> — mounts one 384x224 canvas, letterboxed, pixelated, fixed 60Hz logic.
import { useEffect, useRef } from 'react';
import { Game } from './engine';
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

    const loop = (now: number) => {
      if (!alive || !game) return;
      acc += Math.min(100, now - last); // clamp spiral of death
      last = now;
      while (acc >= STEP) {
        game.step();
        acc -= STEP;
      }
      game.render();
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

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
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
        }}
      />
    </div>
  );
}
