// THE SOVEREIGN CEREMONY — v9.3.3
// One wallet took both thrones of COMPETITION 01 (top wallet + top GONNA NFT).
// When THAT wallet connects, the game mints his coin — once in history.
// No white flashes. Gold, fluo green, darkness. Screenshot-grade.
// v9.3.3: the coin is TRUE PIXEL ART — rendered on canvas with the game's own
// CPS1 5x7 font and palette (milled rim, gecko emboss, name-entry plate).
import { drawText } from './font';

const WINNER = '7XB3ADS5HLBXFJH6NGY7S4Z5AJ6FYT7JOSDALYTOO3SIW3BCAC2Y2NQK4I';
const FLAG = 'gonna.sovereign.v1';
const RM = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let open = false;

function flag(): boolean {
  try { return !!localStorage.getItem(FLAG); } catch { return true; }
}
function setFlag(): void {
  try { localStorage.setItem(FLAG, '1'); } catch { /* private mode — ceremony still plays */ }
}

/** Called by wallet.ts on every successful session (connect / restore). */
export function maybeSovereign(address: string | null): void {
  if (open || !address || address !== WINNER || flag()) return;
  showWarning();
}

/* ================= PIXEL COIN RENDERER (192x160 scene) ================= */
const SW = 192, SH = 160;
const GOLD_L = '#f5d76e', GOLD_M = '#f5c542', GOLD_D = '#d4a937';
const RING_M = '#b8860b', RING_D = '#8a6518', RIM = '#6b4a12', NOTCH = '#4a320c';
const PLATE_BG = '#0d1017', PLATE_B1 = '#b8860b', PLATE_B2 = '#f5c542';
const TXT_A = '#f5d76e', TXT_SUB = '#a0a8b4', SPARK = '#fff3c4', EMBOSS = '#6b4a12';

// THE HEAD — the real GONNA fighter head, extracted pixel-for-pixel from the
// game's own sprite frames (frames/skins/gonna_r0_c0.png, idle pose) and
// quantized to an 8-color palette. Profile right, like a proper struck coin.
const HEAD = [
  '.............................................................',
  '...........................KDMDDDDDDDMMMDDKEE................',
  '..........................DDDMMMMMMMMMMDDDDDKK...............',
  '........................KDDDDDDDDMMMMMMMKDDDDK...............',
  '........................DDDDDKKKKDMMMMMMEDMMMKDMK............',
  '.......................DDDDEEEEEKEEMMMMMEKMMMELcDE...........',
  '......................DMMDKKccCCMKKDMMMMDDMMMEMLLDE..........',
  '.....................KMMMEKCCKEcCDKDDMMMMKMMMKMcLLEE.........',
  '.....................DMDDEcCCKBBCCLKDMMMMMMMMKEEEECcK........',
  '....................KMMDKDCCCMBBCCcKDMMMMMMMMMDKKEccc........',
  '....................DMMDKDcCCDBECCDEDMMMMMMMMMMDDKDKD........',
  '...................KDDMMMMEBBBEEBBBEKDMMMMMMMMMMMMMMKEE......',
  '...................DDDDDDMMLLLMMMMMDDDKDMDMMMMMMMMMMMMDK.....',
  '.................KDMDDDDDDMMMMMMMMMMMDKKEKMDMMMMMMMMMMMMDD...',
  '.................KDDDKDDDDDDDDDDMMMMMMMMDKDKMMMMMMMMMMMMMD...',
  '................KDMDDEDDDDDDKKKDMMMMMMMMMKKMMMMMMMMMMMMMMM...',
  '................DDMDKEKDDDKKKEEKDMMMMMMMMMMMMMMMMMMMMMMMMMD..',
  '................DKMMKEKDMDKKKKKKKDDMMMMMMMMMMMMMMMMMMDDDMMDD.',
  '...............KKKMDKEEKDMMEEKEEDKDMMMMMMMMMMMMMMMMMMEEEKDDD.',
  '...............DDDDDDKEcCcccLKEEKKDDDDDMMMMMMMMMMMMMMMMMMMMMK',
  '..............KDDDDDMMMDLCccCCccDEBEKKDDDDMDMMMMMMMMMMMMMMMMK',
  '..............KKDDDMMcMDDCCCCCCCCcMKEKKKDDDDDDMMMMMDMMMMMMMD.',
  '.............KKKDDKccccDDLcCCCCCccccLMMDKKKKKKKDDKKKKKKKDKK..',
  '............DKEKDDDcccccMKMcCCCCCCCCCCcccLDKKKKKKKKKKKKEEEE..',
  '...........DMKEKDDDccccccLDDcccCCCCCCCCCcccCCCcccccccccMLM...',
  '..........DDDKEKDDDcccCcccLDDMLcCCCCCCCCccCCCCCCCCCcCCCcc....',
  '.........DLLMEBKDDDcccCcCcccLMEEDMMcLccLMLccCCcccccLDDKK.....',
  '........DMLLMKKLDMMLCCCCCLccccLDKKKKKKKKDDDMMDMMMMDDK........',
  '......KKMLLLDKKLMMMLCCCCCcccccccLLMDDMK......................',
  '.....KDMLLLLKKDLLLMMcCCCCccccccccLLLLLD......................',
  '....MLLLLLLLKEMMLLMLcCCCCccccccccccLLLD......................',
  '..EMLLLLLLLLDDLLLLLLcCCCCCCCCCCCCccccLD......................',
  '.KKMLLLLLLLLLLLLLLLLLCCCCCCCCCCCccLcLDKD.....................',
  'KKELLLLLLLLLLLLLLLLLMLcccCCCCCCCCCCCcLLMDD...................',
  '.........LLLLLLLLLLLMMccCCCCCCC..............................',
  '.........LLLLLLLLLMLLLcccCCCCCc..............................',
  '.........LLLLLLLLMLLLMLLLcCCccL..............................',
];
const HEAD_PAL: Record<string, string> = {
  C: '#ddf2b0', c: '#b8db8f', L: '#6fba3e', M: '#5ba635',
  D: '#428d2a', K: '#2d6421', E: '#153010', B: '#000000',
};

const SPARKS_A = [[-30, -26], [27, -8], [-16, 24]];
const SPARKS_B = [[22, -28], [-28, 8], [12, 26]];

function paintScene(cv: HTMLCanvasElement, face: 'blank' | 'A' | 'B', sparkPhase: 0 | 1): void {
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(SW, SH);
  const d = img.data;
  const cx = 96, cy = 57, R = 47;
  const col = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const C = { GOLD_L: col(GOLD_L), GOLD_M: col(GOLD_M), GOLD_D: col(GOLD_D), RING_M: col(RING_M), RING_D: col(RING_D), RIM: col(RIM), NOTCH: col(NOTCH) };
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r > R) continue;
      const a15 = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360 % 15;
      let c: [number, number, number];
      if (r > 44) c = a15 < 5 ? C.NOTCH : C.RIM;
      else if (r > 41) c = C.RING_M;
      else if (r > 38) c = C.RING_D;
      else {
        const t = x + y;
        c = t < 82 ? C.GOLD_L : t < 104 ? C.GOLD_M : C.GOLD_D;
        const ang2 = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        if (r > 30 && ang2 > 20 && ang2 < 110) c = C.GOLD_D;
      }
      const i = (y * SW + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // emboss
  if (face === 'A') {
    const gx = cx - 30, gy = cy - 19;
    // struck-metal shadow: the head silhouette, offset +1,+1 in dark gold
    ctx.fillStyle = EMBOSS;
    for (let yy = 0; yy < HEAD.length; yy++) {
      for (let xx = 0; xx < HEAD[yy].length; xx++) {
        if (HEAD[yy][xx] === '.') continue;
        const sx = gx + xx + 1, sy = gy + yy + 1;
        if (Math.hypot(sx - cx, sy - cy) <= R - 1) ctx.fillRect(sx, sy, 1, 1);
      }
    }
    for (let yy = 0; yy < HEAD.length; yy++) {
      for (let xx = 0; xx < HEAD[yy].length; xx++) {
        const p = HEAD_PAL[HEAD[yy][xx]];
        if (!p) continue;
        ctx.fillStyle = p;
        ctx.fillRect(gx + xx, gy + yy, 1, 1);
      }
    }
  } else if (face === 'B') {
    drawText(ctx, '1B', cx + 1, cy - 21, 5, RING_D, 'center');
    drawText(ctx, '1B', cx, cy - 22, 5, EMBOSS, 'center');
    drawText(ctx, '$GONNA', cx, cy + 13, 2, EMBOSS, 'center');
  }

  // sparkles (blink)
  const sparks = sparkPhase === 0 ? SPARKS_A : SPARKS_B;
  ctx.fillStyle = SPARK;
  for (const [ox, oy] of sparks) {
    const sx = cx + ox, sy = cy + oy;
    ctx.fillRect(sx, sy, 1, 1); ctx.fillRect(sx - 1, sy, 1, 1); ctx.fillRect(sx + 1, sy, 1, 1);
    ctx.fillRect(sx, sy - 1, 1, 1); ctx.fillRect(sx, sy + 1, 1, 1);
  }

  // name-entry plate
  const py0 = 122, py1 = 156;
  ctx.fillStyle = PLATE_B1; ctx.fillRect(6, py0, SW - 12, py1 - py0);
  ctx.fillStyle = PLATE_B2; ctx.fillRect(7, py0 + 1, SW - 14, py1 - py0 - 2);
  ctx.fillStyle = PLATE_BG; ctx.fillRect(9, py0 + 3, SW - 18, py1 - py0 - 6);
  if (face === 'A') {
    drawText(ctx, 'FRIEDBEAN.ALGO', cx, py0 + 6, 2, TXT_A, 'center');
    drawText(ctx, 'SOVEREIGN OF GENESIS', cx, py0 + 23, 1, TXT_SUB, 'center');
  } else if (face === 'B') {
    drawText(ctx, 'THE SWEEP - BOTH THRONES', cx, py0 + 9, 1, TXT_A, 'center');
    drawText(ctx, 'SEALED ON ALGORAND', cx, py0 + 22, 1, TXT_SUB, 'center');
  }
}

function mkScene(face: 'blank' | 'A' | 'B'): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = SW; cv.height = SH;
  cv.className = 'sov-face' + (face === 'B' ? ' back' : '');
  paintScene(cv, face, 0);
  return cv;
}

/* ---------- audio: one deep byzantine thump (user gesture = I'M READY) ---------- */
function thump(): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const t = ctx.currentTime;
    // low sine drop — the hammer
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 1);
    // metallic tick — the die hitting gold
    const o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(2400, t);
    o2.frequency.exponentialRampToValueAtTime(900, t + 0.08);
    g2.gain.setValueAtTime(0.25, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o2.connect(g2).connect(ctx.destination);
    o2.start(t); o2.stop(t + 0.2);
    setTimeout(() => void ctx.close().catch(() => {}), 1500);
  } catch { /* silence is noble too */ }
}

/* ---------- styles ---------- */
const CSS = `
.sov-veil{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(120% 90% at 50% 40%,rgba(14,20,12,.96) 0%,rgba(2,4,3,.985) 70%);
  font-family:'JetBrains Mono',monospace;opacity:0;transition:opacity .45s ease}
.sov-veil.on{opacity:1}
.sov-veil.shake{animation:sovShake .34s cubic-bezier(.2,.7,.2,1)}
@keyframes sovShake{0%{transform:translate(0,0)}18%{transform:translate(-4px,2px)}38%{transform:translate(4px,-2px)}58%{transform:translate(-3px,-1px)}78%{transform:translate(2px,1px)}100%{transform:translate(0,0)}}
.sov-warn{max-width:min(460px,88vw);text-align:center;border:1px solid rgba(201,169,110,.55);border-radius:14px;
  padding:34px 30px 28px;background:linear-gradient(180deg,rgba(20,16,8,.85),rgba(6,8,6,.92));
  box-shadow:0 0 60px rgba(201,169,110,.18),inset 0 0 40px rgba(201,169,110,.05)}
.sov-kick{font-size:10px;letter-spacing:.34em;color:#c9a96a;text-shadow:0 0 14px rgba(201,169,110,.5)}
.sov-t1{margin-top:16px;font-size:13px;letter-spacing:.18em;line-height:2;color:#e8e4da}
.sov-t2{margin-top:10px;font-size:11px;letter-spacing:.22em;line-height:2;color:#39ff6e;text-shadow:0 0 12px rgba(57,255,110,.4)}
.sov-btns{margin-top:26px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.sov-go{font-family:inherit;font-size:11px;letter-spacing:.28em;color:#0a0f0a;background:linear-gradient(180deg,#e9c877,#b8933f);
  border:none;border-radius:9px;padding:13px 26px;cursor:pointer;box-shadow:0 0 24px rgba(201,169,110,.35)}
.sov-go:hover{filter:brightness(1.1)}
.sov-later{font-family:inherit;font-size:10px;letter-spacing:.24em;color:#6a6a7a;background:none;border:1px solid rgba(120,120,140,.3);
  border-radius:9px;padding:13px 20px;cursor:pointer}
.sov-later:hover{color:#a0a0b0}
/* --- the coin: true pixel art on canvas --- */
.sov-stage{perspective:900px;display:flex;flex-direction:column;align-items:center}
.sov-coin{width:min(74vmin,430px);aspect-ratio:192/160;position:relative;transform-style:preserve-3d;
  animation:sovSpin 1.5s cubic-bezier(.25,.7,.25,1) both}
@keyframes sovSpin{0%{transform:rotateY(0) scale(.4);opacity:0}12%{opacity:1}100%{transform:rotateY(720deg) scale(1);opacity:1}}
.sov-coin.faceA{animation:none;transition:transform 1s cubic-bezier(.2,.8,.2,1);transform:rotateY(0)}
.sov-coin.faceB{transition:transform 1.15s cubic-bezier(.2,.8,.2,1);transform:rotateY(180deg)}
.sov-coin.dock{transition:transform 1.1s cubic-bezier(.5,0,.2,1),opacity 1.1s;transform:rotateY(720deg) scale(.18) translateY(-175%);opacity:.95}
.sov-face{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;
  backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:0;background:none;box-shadow:none;border:none;
  filter:drop-shadow(0 0 26px rgba(245,197,66,.28))}
.sov-face.back{transform:rotateY(180deg)}
.sov-wave{position:absolute;left:50%;top:50%;width:min(74vmin,430px);height:min(61.7vmin,358px);border-radius:50%;
  border:2px solid rgba(233,200,119,.85);transform:translate(-50%,-50%);pointer-events:none;opacity:0}
.sov-wave.go{animation:sovWave 1s ease-out .05s both}
@keyframes sovWave{0%{opacity:.9;transform:translate(-50%,-50%) scale(.6)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.1)}}
.sov-cap{position:fixed;left:0;right:0;bottom:9vh;text-align:center;opacity:0;transition:opacity .8s ease}
.sov-cap.on{opacity:1}
.sov-cap1{font-size:clamp(9px,2.4vmin,12px);letter-spacing:.3em;color:#c9a96a;text-shadow:0 0 16px rgba(201,169,110,.5)}
.sov-cap2{margin-top:10px;font-size:clamp(8px,2vmin,10px);letter-spacing:.24em;color:#39ff6e}
.sov-close{margin-top:20px}
.sov-proof{color:#8db8c9;text-decoration:none;border-bottom:1px solid rgba(141,184,201,.35)}
`;

/* ---------- phase 0: the warning ---------- */
function showWarning(): void {
  open = true;
  const style = document.createElement('style');
  style.id = 'sov-css';
  style.textContent = CSS;
  document.head.appendChild(style);
  const v = document.createElement('div');
  v.className = 'sov-veil';
  v.innerHTML = `<div class="sov-warn">
    <div class="sov-kick">⚜ THE CROWN HAS ARRIVED ⚜</div>
    <div class="sov-t1">SOVEREIGN OF GENESIS —<br>THIS PLAYS ONCE IN HISTORY.</div>
    <div class="sov-t2">NO REPLAYS. NO RERUNS.<br>READY YOUR SCREENSHOT, CHAMP.</div>
    <div class="sov-btns">
      <button class="sov-go" type="button">I'M READY →</button>
      <button class="sov-later" type="button">NOT YET</button>
    </div>
  </div>`;
  document.body.appendChild(v);
  requestAnimationFrame(() => v.classList.add('on'));
  v.querySelector('.sov-later')!.addEventListener('click', () => {
    // no flag — the crown waits for the next connect
    v.classList.remove('on');
    setTimeout(() => { v.remove(); style.remove(); open = false; }, 500);
  });
  v.querySelector('.sov-go')!.addEventListener('click', () => {
    v.remove();
    startCeremony();
  });
}

/* ---------- the minting ---------- */
function startCeremony(): void {
  const v = document.createElement('div');
  v.className = 'sov-veil on';
  v.innerHTML = `<div class="sov-stage">
    <div class="sov-coin" id="sovCoin"></div>
    <div class="sov-wave" id="sovWave"></div>
  </div>
  <div class="sov-cap" id="sovCap">
    <div class="sov-cap1">THE COIN IS YOURS FOREVER. SKRRT SKRRT.</div>
    <div class="sov-cap2"><a class="sov-proof" href="https://allo.info/tx/64UCGDUA7DR6VKEH552LJCJR6GCCYMHZMDJODT6PYPM764XSVKZA" target="_blank" rel="noopener">PROOF ON-CHAIN ↗</a></div>
    <div class="sov-close"><button class="sov-go" type="button">ENTER THE VAULT →</button></div>
  </div>`;
  document.body.appendChild(v);
  const coin = v.querySelector('#sovCoin') as HTMLElement;
  const wave = v.querySelector('#sovWave') as HTMLElement;
  const cap = v.querySelector('#sovCap') as HTMLElement;

  // the unstruck disc spins in
  const cvBlank = mkScene('blank');
  coin.appendChild(cvBlank);

  // sparkles blink while the coin is on stage (paused in reduced-motion)
  let phase: 0 | 1 = 0;
  let faces: HTMLCanvasElement[] | null = null;
  let dockCv: HTMLCanvasElement | null = null;
  const blink = RM ? 0 : window.setInterval(() => {
    phase = phase === 0 ? 1 : 0;
    if (faces) {
      paintScene(faces[0], 'A', phase);
      paintScene(faces[1], 'B', phase);
    } else if (dockCv) {
      paintScene(dockCv, 'B', phase);
    } else {
      paintScene(cvBlank, 'blank', phase);
    }
  }, 340);

  const strike = () => {
    v.classList.add('shake');
    wave.classList.add('go');
    thump();
    setTimeout(() => v.classList.remove('shake'), 400);
  };
  const revealA = () => {
    cvBlank.remove();
    const a = mkScene('A'), b = mkScene('B');
    faces = [a, b];
    coin.appendChild(a); coin.appendChild(b);
    coin.classList.add('faceA');
  };
  const revealB = () => coin.classList.add('faceB');
  const dock = () => {
    // 3D card trick ends here: swap in ONE static face-B canvas, always visible.
    // (backface culling is unreliable at tiny scales — the coin docks in 2D.)
    if (faces) { faces[0].remove(); faces[1].remove(); faces = null; }
    const b = mkScene('B');
    b.classList.remove('back');
    b.style.backfaceVisibility = 'visible';
    b.style.setProperty('-webkit-backface-visibility', 'visible');
    coin.appendChild(b);
    dockCv = b;
    coin.classList.add('dock');
    cap.classList.add('on');
    setFlag();
  };

  if (RM) {
    strike(); revealA(); revealB(); dock();
  } else {
    setTimeout(strike, 1500);          // spin ends → the hammer falls
    setTimeout(revealA, 1650);         // struck coin settles on face A
    setTimeout(revealB, 4300);         // the flip — the prize
    setTimeout(dock, 7200);            // docks forever + caption
  }
  v.querySelector('.sov-go')!.addEventListener('click', () => {
    v.classList.remove('on');
    setTimeout(() => {
      if (blink) clearInterval(blink);
      v.remove();
      const st = document.getElementById('sov-css');
      if (st) st.remove();
      open = false;
    }, 500);
  });
}

/* dev-only QA hook — tree-shaken out of production builds */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__sov = {
    warn: showWarning,
    play: () => { const s = document.createElement('style'); s.id = 'sov-css'; s.textContent = CSS; document.head.appendChild(s); startCeremony(); },
    reset: () => { try { localStorage.removeItem(FLAG); } catch { /* noop */ } },
  };
}
